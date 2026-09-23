import { describe, expect, it } from "vitest";
import {
  buildProblemReport,
  deviceName,
  deviceTag,
  flushProblemQueue,
  isRetryable,
  makeClientRef,
  PROBLEM_QUEUE_MAX,
  ProblemSendError,
  queuedProblems,
  queueProblem,
  setDeviceName,
} from "../problemReport";
import { problemReportInputSchema } from "@shared/problemReports";

/** The till's side of the "Problem?" button (v1.2 Phase 8A). */

function memoryStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

const ctx = {
  path: "/operations",
  search: "?pane=order&q=smith",
  device: "Till 2",
  appVersion: "1.2.0",
  online: true,
  queue: { waiting: 2, failed: 1, needsAttention: 3 },
};

describe("device name", () => {
  it("remembers a name from the list and ignores anything else", () => {
    const store = memoryStore();
    expect(deviceName(store)).toBeNull();
    expect(deviceTag(store)).toBe("Not named");
    setDeviceName("Counter tablet", store);
    expect(deviceName(store)).toBe("Counter tablet");
    store.setItem("arcarna.device.name", "Sam's phone");
    expect(deviceName(store)).toBeNull();
    setDeviceName(null, store);
    expect(deviceName(store)).toBeNull();
  });
});

describe("buildProblemReport", () => {
  it("carries screen, device, version, online and queue counts, and passes the server's schema", () => {
    const r = buildProblemReport("error_message", "  Pay froze  ", ctx, { clientRef: "pref-000000001", now: new Date("2026-09-23T10:00:00Z") });
    expect(r).toMatchObject({
      chip: "error_message",
      note: "Pay froze",
      screen: "/operations?pane=order",
      device: "Till 2",
      appVersion: "1.2.0",
      online: true,
      queue: { waiting: 2, failed: 1, needsAttention: 3 },
      reportedAt: "2026-09-23T10:00:00.000Z",
    });
    expect(problemReportInputSchema.safeParse(r).success).toBe(true);
  });

  it("makes client refs the server accepts", () => {
    expect(problemReportInputSchema.shape.clientRef.safeParse(makeClientRef()).success).toBe(true);
  });
});

describe("offline queue", () => {
  it("keeps reports for later and sends only this org's", async () => {
    const store = memoryStore();
    const a = buildProblemReport("too_slow", "", ctx, { clientRef: "pref-aaaaaaaa" });
    const b = buildProblemReport("other", "", ctx, { clientRef: "pref-bbbbbbbb" });
    queueProblem("org-1", a, store);
    queueProblem("org-2", b, store);
    const sent: string[] = [];
    expect(await flushProblemQueue("org-1", async (r) => void sent.push(r.clientRef), store)).toBe(1);
    expect(sent).toEqual(["pref-aaaaaaaa"]);
    expect(queuedProblems(store).map((q) => q.report.clientRef)).toEqual(["pref-bbbbbbbb"]);
  });

  it("keeps a report through a network failure or 5xx, drops one the server refused", async () => {
    const store = memoryStore();
    queueProblem("o", buildProblemReport("too_slow", "", ctx, { clientRef: "pref-net00000" }), store);
    queueProblem("o", buildProblemReport("too_slow", "", ctx, { clientRef: "pref-bad00000" }), store);
    queueProblem("o", buildProblemReport("too_slow", "", ctx, { clientRef: "pref-srv00000" }), store);
    await flushProblemQueue(
      "o",
      async (r) => {
        if (r.clientRef === "pref-net00000") throw new TypeError("Failed to fetch");
        if (r.clientRef === "pref-bad00000") throw new ProblemSendError(400, "no");
        throw new ProblemSendError(503, "down");
      },
      store,
    );
    expect(queuedProblems(store).map((q) => q.report.clientRef)).toEqual(["pref-net00000", "pref-srv00000"]);
    expect(isRetryable(new ProblemSendError(429, "slow"))).toBe(true);
    expect(isRetryable(new ProblemSendError(403, "no"))).toBe(false);
  });

  it("holds at most PROBLEM_QUEUE_MAX reports", () => {
    const store = memoryStore();
    for (let i = 0; i < PROBLEM_QUEUE_MAX + 5; i++) {
      queueProblem("o", buildProblemReport("other", "", ctx, { clientRef: `pref-${String(i).padStart(8, "0")}` }), store);
    }
    expect(queuedProblems(store)).toHaveLength(PROBLEM_QUEUE_MAX);
  });
});
