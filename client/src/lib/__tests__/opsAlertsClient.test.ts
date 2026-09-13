/**
 * `opsAlertsClient.ts` (Phase N, N5b) — the client-side plumbing around
 * `shared/orders/opsAlerts.ts`'s `chimeFor`, which already has its own unit
 * suite for severity ordering and the 2-minute age cutoff (N5a). This file
 * only proves the parts unique to the client: picking a concrete alert id
 * for the cross-tab dedupe set, the dedupe set itself, the mute preference,
 * and that acking calls the real N5a route.
 *
 * `vitest.config.ts` runs this suite under `environment: "node"`, which has
 * no `localStorage` — a fake is stubbed in per test rather than switching the
 * whole file to jsdom, the same reasoning `docs/testing/FAKE_TIME.md` gives
 * for keeping a fake narrow to the thing that actually needs it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_OPS_CHIMED, STORAGE_OPS_SOUND } from "@shared/storageKeys";
import type { OpsBoardAlert } from "@/hooks/useOpsBoard";

const apiRequestMock = vi.fn();
vi.mock("../queryClient", () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
}));

import {
  ackOpsAlert,
  chimeDecisionFor,
  claimChime,
  hasChimed,
  isOpsSoundMuted,
  markChimed,
  setOpsSoundMuted,
} from "../opsAlertsClient";

function fakeLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

function alert(overrides: Partial<OpsBoardAlert> = {}): OpsBoardAlert {
  return {
    id: "alert-1",
    orderId: "order-1",
    kind: "due_soon",
    station: "collection",
    dueAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("opsAlertsClient", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", fakeLocalStorage());
    apiRequestMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("ackOpsAlert", () => {
    it("PATCHes the real N5a route and returns its body", async () => {
      apiRequestMock.mockResolvedValue({
        json: async () => ({ id: "alert-1", ackedAt: "2026-09-13T10:00:00.000Z", changed: true }),
      });

      const result = await ackOpsAlert("alert-1");

      expect(apiRequestMock).toHaveBeenCalledWith("PATCH", "/api/operations/alerts/alert-1/ack");
      expect(result).toEqual({ id: "alert-1", ackedAt: "2026-09-13T10:00:00.000Z", changed: true });
    });
  });

  describe("chimeDecisionFor", () => {
    const now = new Date("2026-09-13T10:00:00.000Z");
    const recent = new Date(now.getTime() - 30_000).toISOString();

    it("returns null when nothing delivered should chime", () => {
      // The assignee's own due_soon (station: "") never chimes — see
      // shared/orders/opsAlerts.ts's own chimeFor doc comment.
      expect(chimeDecisionFor([alert({ kind: "due_soon", station: "", createdAt: recent })], now)).toBeNull();
    });

    it("picks the id of the delivered row matching chimeFor's winning kind", () => {
      const dueSoon = alert({ id: "a-due-soon", kind: "due_soon", station: "collection", createdAt: recent });
      const lateOne = alert({ id: "a-late", orderId: "order-2", kind: "late", station: "collection", createdAt: recent });
      // late outranks due_soon (brief: "customer_waiting > late > assigned >
      // new_unassigned > due_soon") — the decision must point at the LATE
      // row's id, not the due-soon one that happened to be first in the array.
      const decision = chimeDecisionFor([dueSoon, lateOne], now);
      expect(decision).toEqual({ kind: "late", alertId: "a-late" });
    });

    it("ignores a row older than the 2-minute chime cutoff", () => {
      const stale = alert({ createdAt: new Date(now.getTime() - 5 * 60_000).toISOString() });
      expect(chimeDecisionFor([stale], now)).toBeNull();
    });
  });

  describe("cross-tab chime dedupe (STORAGE_OPS_CHIMED)", () => {
    it("hasChimed is false until markChimed records the id", async () => {
      expect(hasChimed("alert-1")).toBe(false);
      markChimed("alert-1");
      expect(hasChimed("alert-1")).toBe(true);
    });

    it("is idempotent — marking the same id twice does not duplicate it", async () => {
      markChimed("alert-1");
      markChimed("alert-1");
      const stored = JSON.parse(localStorage.getItem(STORAGE_OPS_CHIMED) ?? "[]");
      expect(stored.filter((id: string) => id === "alert-1")).toHaveLength(1);
    });

    it("caps the stored set so a long shift cannot grow it forever", async () => {
      for (let i = 0; i < 400; i++) markChimed(`alert-${i}`);
      const stored = JSON.parse(localStorage.getItem(STORAGE_OPS_CHIMED) ?? "[]");
      expect(stored.length).toBeLessThanOrEqual(300);
      // The most recent ids survive the trim, not the oldest.
      expect(stored).toContain("alert-399");
      expect(stored).not.toContain("alert-0");
    });

    it("degrades to always-chime rather than throwing when storage is unavailable", async () => {
      vi.stubGlobal("localStorage", {
        getItem: () => {
          throw new Error("storage disabled");
        },
        setItem: () => {
          throw new Error("storage disabled");
        },
      });
      expect(hasChimed("alert-1")).toBe(false);
      expect(() => markChimed("alert-1")).not.toThrow();
    });
  });

  /**
   * N5b gap fix: `hasChimed` + `markChimed` as two separate steps is a plain
   * check-then-write, fine for deliveries an ordinary amount of time apart
   * but not for `opsBus`'s live push, which can deliver the SAME alert to
   * every open tab within the same instant. `claimChime` wraps both in one
   * `navigator.locks` request so cross-tab exclusion is real, with a
   * fallback to the old check-then-write when Web Locks is unavailable.
   */
  describe("claimChime (atomic cross-tab dedupe)", () => {
    it("the first caller wins and marks the id", async () => {
      const won = await claimChime("alert-1");
      expect(won).toBe(true);
      expect(hasChimed("alert-1")).toBe(true);
    });

    it("a second caller for the SAME id loses, even without navigator.locks (falls back to check-then-write)", async () => {
      expect(await claimChime("alert-1")).toBe(true);
      expect(await claimChime("alert-1")).toBe(false);
    });

    it("uses navigator.locks for real mutual exclusion when it is available", async () => {
      const requestMock = vi.fn(async (_name: string, cb: () => unknown) => cb());
      vi.stubGlobal("navigator", { locks: { request: requestMock } });

      const won = await claimChime("alert-2");

      expect(won).toBe(true);
      expect(requestMock).toHaveBeenCalledWith("arcarna-ops-alert-chime", expect.any(Function));
      expect(hasChimed("alert-2")).toBe(true);
    });

    it("two concurrent claims serialised through navigator.locks produce exactly one winner", async () => {
      // A minimal in-memory stand-in for the Web Locks API's own mutual
      // exclusion: only one callback runs at a time, queued FIFO — enough to
      // prove `claimChime` composes correctly with a REAL exclusive lock,
      // without depending on a browser's actual lock manager in a node test
      // environment.
      let busy: Promise<unknown> = Promise.resolve();
      const fakeLocks = {
        request: (_name: string, cb: () => unknown) => {
          const run = busy.then(cb);
          busy = run.catch(() => {});
          return run;
        },
      };
      vi.stubGlobal("navigator", { locks: fakeLocks });

      const [a, b] = await Promise.all([claimChime("alert-3"), claimChime("alert-3")]);

      expect([a, b].sort()).toEqual([false, true]);
    });

    it("falls back to the best-effort path when navigator.locks itself throws", async () => {
      vi.stubGlobal("navigator", {
        locks: {
          request: () => {
            throw new Error("locks unavailable");
          },
        },
      });
      const won = await claimChime("alert-4");
      expect(won).toBe(true);
      expect(hasChimed("alert-4")).toBe(true);
    });
  });

  describe("mute preference (STORAGE_OPS_SOUND)", () => {
    it("defaults to sound ON", async () => {
      expect(isOpsSoundMuted()).toBe(false);
    });

    it("round-trips a mute through localStorage", async () => {
      setOpsSoundMuted(true);
      expect(isOpsSoundMuted()).toBe(true);
      expect(localStorage.getItem(STORAGE_OPS_SOUND)).toBe("muted");
      setOpsSoundMuted(false);
      expect(isOpsSoundMuted()).toBe(false);
    });
  });
});
