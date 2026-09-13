/**
 * Offline replay keeps its real received time (N3a, finding G21).
 *
 * Before this package `_offlineQueuedAt` was honoured only inside the full
 * cashier-shift replay branch — a signed token set by `shift-open.tsx`, which
 * has been unmounted since PR #136 — so on every org that has ever actually
 * run, a replayed offline order was born "received now" no matter how long it
 * sat in the queue. `resolveOfflineQueuedAt` and its use in
 * `requireActiveCashierShift.ts`'s `cashierShiftMiddleware` fix that on the
 * ordinary lazy-shift path, with no token required, bounded to today's
 * trading day so a long-stale queue cannot silently backdate a sale.
 *
 * No database beyond a mocked `../db`: `orgTimeZone` and the middleware's own
 * org lookup both `SELECT … FROM organizations`, satisfied here by one fixed
 * row carrying every column either query projects.
 */
import type { RequestHandler } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG_ID = "00000000-0000-4000-8000-0000000000aa";

const state = vi.hoisted(() => ({
  org: {} as Record<string, unknown>,
}));

vi.mock("../db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([state.org]) }),
      }),
    }),
  },
}));

// No open shift for this user in these tests — irrelevant to what
// `req.offlineQueuedAt` ends up as, and it would otherwise need a real
// `cashier_shifts` row.
vi.mock("../services/tradingDayShift", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/tradingDayShift")>();
  return { ...actual, resolveShiftForToday: vi.fn().mockResolvedValue(null) };
});

const { resolveOfflineQueuedAt } = await import("../middleware/requireActiveCashierShift");
const { requireActiveCashierShift, attachActiveCashierShift } = await import(
  "../middleware/requireActiveCashierShift"
);

const TIMEZONE = "Europe/London";

beforeEach(() => {
  state.org = {
    cashierCommissionEnabled: false,
    requireCashierForSale: false,
    timezone: TIMEZONE,
  };
});

describe("resolveOfflineQueuedAt", () => {
  const now = new Date("2026-09-12T14:00:00.000Z"); // 15:00 BST — well inside today's trading day

  it("accepts a queued instant earlier today", () => {
    const queuedAt = new Date(now.getTime() - 30 * 60_000).toISOString();
    const resolved = resolveOfflineQueuedAt(queuedAt, TIMEZONE, now);
    expect(resolved?.toISOString()).toBe(new Date(queuedAt).toISOString());
  });

  it("refuses a malformed or missing value", () => {
    expect(resolveOfflineQueuedAt(undefined, TIMEZONE, now)).toBeUndefined();
    expect(resolveOfflineQueuedAt("", TIMEZONE, now)).toBeUndefined();
    expect(resolveOfflineQueuedAt("not a date", TIMEZONE, now)).toBeUndefined();
    expect(resolveOfflineQueuedAt(12345, TIMEZONE, now)).toBeUndefined();
  });

  it("refuses a value in the future (a tablet with a fast clock)", () => {
    const future = new Date(now.getTime() + 60_000).toISOString();
    expect(resolveOfflineQueuedAt(future, TIMEZONE, now)).toBeUndefined();
  });

  it("refuses a value from before today's trading day started", () => {
    // Today's trading day starts at 06:00 local; 05:00 UTC is 06:00 BST, so
    // one minute earlier is still yesterday's day.
    const beforeTradingDay = new Date("2026-09-12T04:59:00.000Z").toISOString();
    expect(resolveOfflineQueuedAt(beforeTradingDay, TIMEZONE, now)).toBeUndefined();
  });

  it("accepts a value exactly at today's trading-day start", () => {
    const atStart = new Date("2026-09-12T05:00:00.000Z"); // 06:00 BST
    expect(resolveOfflineQueuedAt(atStart.toISOString(), TIMEZONE, now)?.getTime()).toBe(
      atStart.getTime(),
    );
  });
});

describe("the middleware attaches req.offlineQueuedAt without a cashier-shift token", () => {
  function runMiddleware(
    handler: RequestHandler,
    req: Record<string, unknown>,
  ): Promise<{ req: any; nextCalled: boolean; status?: number }> {
    const request: any = { orgContext: { orgId: ORG_ID }, headers: {}, query: {}, body: {}, ...req };
    let nextCalled = false;
    let status: number | undefined;
    const res: any = {
      status(code: number) {
        status = code;
        return this;
      },
      json() {
        return this;
      },
    };
    return new Promise((resolve) => {
      void (handler as any)(request, res, () => {
        nextCalled = true;
        resolve({ req: request, nextCalled, status });
      });
      // A refusal never calls next(); resolve on the next tick either way.
      setImmediate(() => resolve({ req: request, nextCalled, status }));
    });
  }

  it("sets req.offlineQueuedAt from a bare _offlineQueuedAt field — no _offlineOrderReplay, no token, no cashier code", async () => {
    const queuedAt = new Date(Date.now() - 1 * 60_000).toISOString();
    const { req } = await runMiddleware(requireActiveCashierShift, {
      body: { _offlineQueuedAt: queuedAt },
      user: { id: "cashier-1" },
    });
    expect(req.offlineQueuedAt?.toISOString()).toBe(new Date(queuedAt).toISOString());
  });

  it("still resolves it when the org does not track cashier commission at all", async () => {
    state.org.cashierCommissionEnabled = false;
    const queuedAt = new Date(Date.now() - 1 * 60_000).toISOString();
    const { req, nextCalled } = await runMiddleware(attachActiveCashierShift, {
      body: { _offlineQueuedAt: queuedAt },
      user: { id: "cashier-1" },
    });
    expect(nextCalled).toBe(true);
    expect(req.offlineQueuedAt).toBeInstanceOf(Date);
  });

  it("leaves it undefined when no _offlineQueuedAt was sent at all", async () => {
    const { req } = await runMiddleware(requireActiveCashierShift, {
      body: {},
      user: { id: "cashier-1" },
    });
    expect(req.offlineQueuedAt).toBeUndefined();
  });

  it("leaves it undefined for a value the resolver refuses (future / stale / malformed)", async () => {
    const { req } = await runMiddleware(requireActiveCashierShift, {
      body: { _offlineQueuedAt: "garbage" },
      user: { id: "cashier-1" },
    });
    expect(req.offlineQueuedAt).toBeUndefined();
  });
});
