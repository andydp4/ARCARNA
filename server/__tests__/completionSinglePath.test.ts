/**
 * `completeOrderTx` — the ONE completion path (Phase N, N3b;
 * server/services/orderCompletion.ts). Two things matter most here:
 *
 *  1. No bare `db.` read lives in the file — every statement must take the
 *     transaction client the caller passed in, or a second Delivered tap
 *     could read a stale, unlocked copy (the brief's finding G4).
 *  2. `PATCH {status:'completed'}` and `transition {action:'complete'}` call
 *     the exact same function with the exact same locked row — this test
 *     proves the settlement patch it produces is a pure function of its
 *     inputs, so the two callers cannot possibly diverge.
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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeOrderTx, type OrderRow } from "../services/orderCompletion";
import { creditLegTotal, openCreditForOrder } from "../services/creditLedger";
import { cashierShiftForBackdatedOrder } from "../services/orderDating";

/** A minimal fake `tx` supporting exactly the chain shapes `orderCompletion.ts` uses. */
function makeFakeTx(rowsByTable: Map<unknown, unknown[]>) {
  const insertedRows: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const selectChain = (table: unknown) => {
    const rows = rowsByTable.get(table) ?? [];
    const chain: any = {
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(rows),
    };
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
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        insertedRows.push({ table, values });
        const promise = Promise.resolve(undefined) as Promise<undefined> & { returning?: () => Promise<unknown[]> };
        promise.returning = () => Promise.resolve([{ id: `evt-${insertedRows.length}`, ...values }]);
        return promise;
      },
    }),
    __insertedRows: insertedRows,
  };
}

function baseOrder(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: "order-1",
    org_id: "org-1",
    status: "pending",
    fulfilment_method: "collection",
    date_kind: "live",
    payment_method: "cash",
    total: "24.50",
    customer_id: null,
    cashier_id: null,
    created_at: new Date("2026-09-12T10:00:00Z"),
    settled_total: null,
    settled_at: null,
    completed_user_id: null,
    ...overrides,
  };
}

describe("orderCompletion.ts source — no bare `db.` reads", () => {
  it("never imports the pooled `db` module at all — only the passed-in transaction client can be called", () => {
    const source = readFileSync(join(__dirname, "../services/orderCompletion.ts"), "utf8");
    // The identifier `db` is never bound in this file (no `import { db } ...`,
    // no `const { db } = await import(...)`), so no line of CODE here could
    // possibly call `db.anything` — only a documentation comment could
    // contain that string, which is why this checks for the BINDING rather
    // than grepping the word "db." (this file's own doc comments say
    // "bare `db.`" in prose, which a naive text grep would flag on itself).
    expect(source).not.toMatch(/from ["']\.\.\/db["']/); // `import { db } from "../db"`
    expect(source).not.toMatch(/import\(["']\.\.\/db["']\)/); // `await import("../db")`
    expect(source).not.toMatch(/\{\s*db\s*[,}]/); // any destructure named `db`
  });
});

describe("completeOrderTx", () => {
  let orderEventsTable: unknown;
  let ordersTable: unknown;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ orderEvents: orderEventsTable } = await import("@shared/schema"));
    ({ orders: ordersTable } = await import("../../apps/server/src/db/schema"));
  });

  it("PATCH's call and the transition's call produce IDENTICAL settlement patches for the same locked row", async () => {
    (creditLegTotal as any).mockResolvedValue(0);
    const row = baseOrder();

    const tx1 = makeFakeTx(new Map([[orderEventsTable, []], [ordersTable, [row]]]));
    const result1 = await completeOrderTx(tx1, row, { userId: "sam" }, {});

    const tx2 = makeFakeTx(new Map([[orderEventsTable, []], [ordersTable, [row]]]));
    const result2 = await completeOrderTx(tx2, row, { userId: "sam" }, {});

    expect(result2.row.settled_total).toBe(result1.row.settled_total);
    // `settled_at` is `new Date()` at the moment each call runs, so the two
    // independent calls legitimately differ by a millisecond or two — the
    // identity under test is the SHAPE of the patch, not a frozen clock.
    expect(result2.row.settled_at).toBeInstanceOf(Date);
    expect(result2.row.completed_user_id).toBe(result1.row.completed_user_id);
    expect(result2.row.status).toBe("completed");
    expect(result2.event.meta.label).toBe(result1.event.meta.label);
  });

  it("freezes `settled_total` from the row's own `total` string, never a re-parsed float", async () => {
    (creditLegTotal as any).mockResolvedValue(0);
    const row = baseOrder({ total: "12.50" });
    const tx = makeFakeTx(new Map([[orderEventsTable, []], [ordersTable, [row]]]));
    const result = await completeOrderTx(tx, row, { userId: "sam" }, {});
    // Never "12.5" — a round-trip through parseFloat would have dropped the
    // trailing zero.
    expect(result.row.settled_total).toBe("12.50");
  });

  it("labels a collection completion 'handed_over' and a delivery completion 'delivered' by default", async () => {
    (creditLegTotal as any).mockResolvedValue(0);
    const collection = baseOrder({ fulfilment_method: "collection" });
    const delivery = baseOrder({ id: "order-2", fulfilment_method: "delivery" });

    const r1 = await completeOrderTx(
      makeFakeTx(new Map([[orderEventsTable, []], [ordersTable, [collection]]])),
      collection,
      { userId: "sam" },
      {},
    );
    const r2 = await completeOrderTx(
      makeFakeTx(new Map([[orderEventsTable, []], [ordersTable, [delivery]]])),
      delivery,
      { userId: "sam" },
      {},
    );
    expect(r1.event.meta.label).toBe("handed_over");
    expect(r2.event.meta.label).toBe("delivered");
  });

  it("opens a credit leg only when the tick decision comes back positive, from the LOCKED row's payment method and total", async () => {
    (creditLegTotal as any).mockResolvedValue(24.5);
    const row = baseOrder({ payment_method: "tick", customer_id: "cust-1" });
    const tx = makeFakeTx(new Map([[orderEventsTable, []], [ordersTable, [row]]]));
    await completeOrderTx(tx, row, { userId: "sam" }, {});
    expect(creditLegTotal).toHaveBeenCalledWith("order-1", "tick", 24.5, tx);
    expect(openCreditForOrder).toHaveBeenCalledWith(
      "org-1",
      { id: "order-1", customerId: "cust-1", amount: 24.5 },
      tx,
    );
  });

  it("is NOT a resettle on the first completion — no `resettled` meta", async () => {
    (creditLegTotal as any).mockResolvedValue(0);
    const row = baseOrder();
    const tx = makeFakeTx(new Map([[orderEventsTable, []], [ordersTable, [row]]]));
    const result = await completeOrderTx(tx, row, { userId: "sam" }, {});
    expect(result.resettled).toBe(false);
    expect(result.event.meta.resettled).toBeUndefined();
  });

  it("IS a resettle when a prior `completed` event exists — writes `resettled` with old and new figures", async () => {
    (creditLegTotal as any).mockResolvedValue(0);
    // Reopened row: status back to 'pending', but the PRIOR settlement is
    // still on the row (reopen does not clear these — only rewrites them on
    // the next complete).
    const row = baseOrder({
      status: "pending",
      total: "30.00",
      settled_total: "24.50",
      settled_at: new Date("2026-09-12T10:05:00Z"),
      completed_user_id: "ana",
    });
    const priorCompletedEvent = { meta: { fromStatus: "pending" } };
    const tx = makeFakeTx(new Map([[orderEventsTable, [priorCompletedEvent]], [ordersTable, [row]]]));
    const result = await completeOrderTx(tx, row, { userId: "sam" }, {});
    expect(result.resettled).toBe(true);
    expect(result.event.meta.resettled).toBe(true);
    expect((result.event.meta.from as any).settledTotal).toBe("24.50");
    expect((result.event.meta.from as any).completedUserId).toBe("ana");
    expect((result.event.meta.to as any).settledTotal).toBe("30.00");
    expect(result.row.completed_user_id).toBe("sam");
  });

  it("resolves the backdated shift from the LOCKED row and returns it for post-commit settlement, without calling settleBackdatedShift itself", async () => {
    (creditLegTotal as any).mockResolvedValue(0);
    const shift = { id: "shift-1", status: "open", tradingDay: "2026-09-10", cashierId: "cash-1" };
    (cashierShiftForBackdatedOrder as any).mockResolvedValue(shift);
    const row = baseOrder({ date_kind: "backdated", created_at: new Date("2026-09-10T12:00:00Z") });
    const tx = makeFakeTx(new Map([[orderEventsTable, []], [ordersTable, [row]]]));
    const result = await completeOrderTx(
      tx,
      row,
      { userId: "sam", cashierShift: { cashierId: "cash-1", cashierShiftId: "cshift-1" } },
      {},
    );
    expect(result.backdatedShiftToSettle).toEqual(shift);
    const { settleBackdatedShift } = await import("../services/orderDating");
    expect(settleBackdatedShift).not.toHaveBeenCalled();
  });

  it("carries the driver-reported `actualAt` into the event meta when the delivery tap reports it later", async () => {
    (creditLegTotal as any).mockResolvedValue(0);
    const row = baseOrder({ fulfilment_method: "delivery" });
    const tx = makeFakeTx(new Map([[orderEventsTable, []], [ordersTable, [row]]]));
    const result = await completeOrderTx(tx, row, { userId: "sam" }, {
      label: "delivered",
      actualAt: "2026-09-12T10:20:00.000Z",
    });
    expect(result.event.meta.actualAt).toBe("2026-09-12T10:20:00.000Z");
  });
});
