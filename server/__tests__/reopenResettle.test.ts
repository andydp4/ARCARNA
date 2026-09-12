/**
 * `reopenOrderTx` and the re-settlement it enables (Phase N, N3b;
 * server/services/orderCompletion.ts). Covers every refusal the brief names
 * — a refund exists, the credit has payments, the trading day has closed —
 * and that a successful reopen restores the INTERRUPTED status (from the
 * `completed` event's own `meta.fromStatus`), never a value the caller sent.
 */
vi.mock("../services/creditLedger", () => ({
  creditLegTotal: vi.fn(),
  openCreditForOrder: vi.fn(),
  voidCredit: vi.fn(),
}));
vi.mock("../services/orderDating", () => ({
  cashierShiftForBackdatedOrder: vi.fn(),
  settleBackdatedShift: vi.fn(),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  completeOrderTx,
  OrderReopenRefusedError,
  reopenOrderTx,
  type OrderRow,
} from "../services/orderCompletion";
import { creditLegTotal, voidCredit } from "../services/creditLedger";

function makeFakeTx(rowsByTable: Map<unknown, unknown[]>) {
  const selectChain = (table: unknown) => {
    const rows = rowsByTable.get(table) ?? [];
    const chain: any = { where: () => chain, orderBy: () => chain, limit: () => Promise.resolve(rows) };
    return chain;
  };
  return {
    select: () => ({ from: selectChain }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            const base = (rowsByTable.get(table) as Array<Record<string, unknown>> | undefined)?.[0] ?? {};
            const merged = { ...base, ...patch };
            rowsByTable.set(table, [merged]);
            return Promise.resolve([merged]);
          },
        }),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        const promise = Promise.resolve(undefined) as Promise<undefined> & { returning?: () => Promise<unknown[]> };
        promise.returning = () => Promise.resolve([{ id: "evt-1", ...values }]);
        return promise;
      },
    }),
  };
}

function baseOrder(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: "order-1",
    org_id: "org-1",
    status: "completed",
    fulfilment_method: "collection",
    date_kind: "live",
    payment_method: "cash",
    total: "24.50",
    customer_id: null,
    cashier_id: null,
    created_at: new Date("2026-09-12T10:00:00Z"),
    settled_total: "24.50",
    settled_at: new Date("2026-09-12T10:05:00Z"),
    completed_user_id: "sam",
    ...overrides,
  };
}

/** Every table `reopenOrderTx` reads, pre-seeded empty unless a test overrides one. */
async function tables() {
  const { orderEvents, orderCredit, refunds, creditPayments, organizations, dailyCloseRuns } = await import(
    "@shared/schema"
  );
  const { orders } = await import("../../apps/server/src/db/schema");
  return { orderEvents, orderCredit, refunds, creditPayments, organizations, dailyCloseRuns, orders };
}

describe("reopenOrderTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses when a refund has been issued — writes nothing", async () => {
    const t = await tables();
    const row = baseOrder();
    const tx = makeFakeTx(
      new Map([
        [t.refunds, [{ id: "refund-1" }]],
        [t.orders, [row]],
      ]),
    );
    await expect(reopenOrderTx(tx, row, { userId: "sam" })).rejects.toThrow(OrderReopenRefusedError);
    expect(voidCredit).not.toHaveBeenCalled();
  });

  it("refuses when the credit leg has payments recorded", async () => {
    const t = await tables();
    const row = baseOrder({ payment_method: "tick" });
    const tx = makeFakeTx(
      new Map([
        [t.refunds, []],
        [t.orderCredit, [{ status: "outstanding", amountGiven: "24.50", amountOutstanding: "10.00" }]],
        [t.creditPayments, [{ id: "payment-1" }]],
        [t.orders, [row]],
      ]),
    );
    await expect(reopenOrderTx(tx, row, { userId: "sam" })).rejects.toThrow(OrderReopenRefusedError);
    expect(voidCredit).not.toHaveBeenCalled();
  });

  it("refuses with ORDER_REOPEN_CLOSED_DAY once the settlement's trading day has a daily-close row", async () => {
    const t = await tables();
    const row = baseOrder({ settled_at: new Date("2026-09-10T20:00:00Z") });
    const tx = makeFakeTx(
      new Map([
        [t.refunds, []],
        [t.orderCredit, []],
        [t.organizations, [{ timezone: "Europe/London" }]],
        [t.dailyCloseRuns, [{ id: "close-1" }]],
        [t.orders, [row]],
      ]),
    );
    const error = await reopenOrderTx(tx, row, { userId: "sam" }).catch((e) => e);
    expect(error).toBeInstanceOf(OrderReopenRefusedError);
    expect(error.code).toBe("ORDER_REOPEN_CLOSED_DAY");
  });

  it("succeeds when the credit exists but has NO payments (voids it) and the day has not closed", async () => {
    const t = await tables();
    const row = baseOrder({ payment_method: "tick" });
    const tx = makeFakeTx(
      new Map([
        [t.refunds, []],
        [t.orderCredit, [{ status: "outstanding", amountGiven: "24.50", amountOutstanding: "24.50" }]],
        [t.creditPayments, []],
        [t.organizations, [{ timezone: "Europe/London" }]],
        [t.dailyCloseRuns, []],
        [t.orderEvents, [{ meta: { fromStatus: "pending" } }]],
        [t.orders, [row]],
      ]),
    );
    const result = await reopenOrderTx(tx, row, { userId: "sam" });
    expect(result.creditVoided).toBe(true);
    expect(voidCredit).toHaveBeenCalledWith("org-1", "order-1", tx);
  });

  it("restores the status the `completed` event recorded as `fromStatus` — never a caller-supplied value", async () => {
    const t = await tables();
    const row = baseOrder();
    const tx = makeFakeTx(
      new Map([
        [t.refunds, []],
        [t.orderCredit, []],
        [t.organizations, [{ timezone: "Europe/London" }]],
        [t.dailyCloseRuns, []],
        [t.orderEvents, [{ meta: { fromStatus: "on-hold" } }]],
        [t.orders, [row]],
      ]),
    );
    const result = await reopenOrderTx(tx, row, { userId: "sam" });
    expect(result.row.status).toBe("on-hold");
  });

  it("falls back to 'pending' when there is no `completed` event to read (defensive)", async () => {
    const t = await tables();
    const row = baseOrder();
    const tx = makeFakeTx(
      new Map([
        [t.refunds, []],
        [t.orderCredit, []],
        [t.organizations, [{ timezone: "Europe/London" }]],
        [t.dailyCloseRuns, []],
        [t.orderEvents, []],
        [t.orders, [row]],
      ]),
    );
    const result = await reopenOrderTx(tx, row, { userId: "sam" });
    expect(result.row.status).toBe("pending");
  });

  it("writes the `reopened` event carrying the prior settlement and the void flag", async () => {
    const t = await tables();
    const row = baseOrder();
    const tx = makeFakeTx(
      new Map([
        [t.refunds, []],
        [t.orderCredit, []],
        [t.organizations, [{ timezone: "Europe/London" }]],
        [t.dailyCloseRuns, []],
        [t.orderEvents, [{ meta: { fromStatus: "pending" } }]],
        [t.orders, [row]],
      ]),
    );
    const result = await reopenOrderTx(tx, row, { userId: "sam" });
    expect(result.event.kind).toBe("reopened");
    expect(result.event.meta).toEqual({
      settledTotal: "24.50",
      settledAt: row.settled_at,
      completedUserId: "sam",
      creditVoided: false,
    });
  });
});

describe("re-complete after reopen re-settles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("a later `complete` on a reopened row rewrites the settlement for the CURRENT total and actor", async () => {
    (creditLegTotal as any).mockResolvedValue(0);
    const t = await tables();

    // Step 1: reopen a completed £24.50 order back to 'pending'.
    const completedRow = baseOrder();
    const reopenTx = makeFakeTx(
      new Map([
        [t.refunds, []],
        [t.orderCredit, []],
        [t.organizations, [{ timezone: "Europe/London" }]],
        [t.dailyCloseRuns, []],
        [t.orderEvents, [{ meta: { fromStatus: "pending" } }]],
        [t.orders, [completedRow]],
      ]),
    );
    const reopened = await reopenOrderTx(reopenTx, completedRow, { userId: "sam" });
    expect(reopened.row.status).toBe("pending");

    // Step 2: the total changed while it was open (a line was added), then
    // it is completed again by a DIFFERENT person.
    const reopenedRow = { ...reopened.row, total: "31.00" };
    const completeTx = makeFakeTx(
      new Map([
        [t.orderEvents, [{ meta: { fromStatus: "pending" } }]], // a prior `completed` event exists
        [t.orders, [reopenedRow]],
      ]),
    );
    const resettled = await completeOrderTx(completeTx, reopenedRow, { userId: "ana" }, {});

    expect(resettled.resettled).toBe(true);
    expect(resettled.row.settled_total).toBe("31.00");
    expect(resettled.row.completed_user_id).toBe("ana");
    expect((resettled.event.meta.from as any).settledTotal).toBe("24.50");
    expect((resettled.event.meta.from as any).completedUserId).toBe("sam");
    expect((resettled.event.meta.to as any).settledTotal).toBe("31.00");
    expect((resettled.event.meta.to as any).completedUserId).toBe("ana");
  });
});
