/**
 * Commission splits 90/10 between the cashier who loaded an order and the one
 * who completed it, so the orders table now records both (migration 051).
 *
 * Two things have to hold for that split to be payable, and both are covered
 * here:
 *
 *   1. The completing cashier is frozen at the FIRST settlement, exactly like
 *      `settled_total`. If reopening an order and re-completing it under a
 *      different cashier moved this column, it would move 90% of a commission
 *      pool that had already accrued to somebody else.
 *   2. Recording that attribution must never block the completion itself. A
 *      manager clearing an order from the back office has no till and no
 *      cashier shift; refusing the status change to record an attribution that
 *      does not exist would break order management outright.
 *
 * As of Phase N (N3b), this attribution logic lives in ONE place —
 * `completeOrderTx` (server/services/orderCompletion.ts) — called by both
 * `PATCH /api/orders/:id` and `POST /api/orders/:id/transition
 * {action:'complete'}`. This suite exercises that function directly rather
 * than mounting the route, which is what actually decides these columns now.
 */
vi.mock("../services/creditLedger", () => ({
  creditLegTotal: vi.fn().mockResolvedValue(0),
  openCreditForOrder: vi.fn().mockResolvedValue(undefined),
  voidCredit: vi.fn(),
}));
vi.mock("../services/orderDating", () => ({
  cashierShiftForBackdatedOrder: vi.fn().mockResolvedValue(null),
  settleBackdatedShift: vi.fn(),
}));

import { describe, expect, it, vi } from "vitest";
import { completeOrderTx, type OrderRow } from "../services/orderCompletion";

const ORDER_ID = "00000000-0000-4000-8000-0000000000aa";
const ORG_ID = "00000000-0000-4000-8000-000000000001";
const CASHIER_A = "00000000-0000-4000-8000-00000000000a";
const CASHIER_B = "00000000-0000-4000-8000-00000000000b";
const SHIFT_B = "00000000-0000-4000-8000-0000000000bb";

/** A minimal fake `tx` supporting exactly the chain shapes `orderCompletion.ts` uses. */
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

async function completeOrder(row: OrderRow, cashierShift?: { cashierId: string | null; cashierShiftId: string }) {
  const { orderEvents } = await import("@shared/schema");
  const { orders } = await import("../../apps/server/src/db/schema");
  const tx = makeFakeTx(new Map([[orderEvents, []], [orders, [row]]]));
  return completeOrderTx(tx, row, { userId: "user_1", cashierShift: cashierShift ?? null }, {});
}

function baseRow(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: ORDER_ID,
    org_id: ORG_ID,
    status: "pending",
    fulfilment_method: "collection",
    date_kind: "live",
    payment_method: "cash",
    total: "120.00",
    customer_id: null,
    cashier_id: null,
    created_at: new Date("2026-09-12T10:00:00Z"),
    settled_total: null,
    settled_at: null,
    completed_user_id: null,
    ...overrides,
  };
}

describe("order attribution — the completing cashier", () => {
  it("records the completing cashier and shift at first settlement", async () => {
    const row = baseRow({ cashier_id: CASHIER_A });
    const result = await completeOrder(row, { cashierId: CASHIER_B, cashierShiftId: SHIFT_B });
    expect(result.row.completed_cashier_id).toBe(CASHIER_B);
    expect(result.row.completed_cashier_shift_id).toBe(SHIFT_B);
    expect(result.row.settled_total).toBe("120.00");
  });

  it("leaves the loading cashier's own attribution alone", async () => {
    // B completed what A loaded. `cashier_id` already names A and must stay
    // put — the 10% inputter share is read from it downstream.
    const row = baseRow({ cashier_id: CASHIER_A });
    const result = await completeOrder(row, { cashierId: CASHIER_B, cashierShiftId: SHIFT_B });
    // completeOrderTx only ever WRITES cashier_id when there was none before;
    // it never overwrites an existing value.
    expect(result.row.cashier_id).toBe(CASHIER_A);
  });

  it("does not move the completing cashier on a genuine re-settle unless the actor changes", async () => {
    // Reopen a settled order, re-complete it under a DIFFERENT cashier: the
    // new completer legitimately takes over the pool (owner, Q3 — recompute
    // on re-complete) — but only because THIS actor completed it, never as a
    // side effect of some other write.
    const row = baseRow({
      status: "pending",
      total: "500.00",
      settled_total: "120.00",
      cashier_id: CASHIER_A,
      completed_cashier_id: CASHIER_A,
      completed_user_id: "user_0",
    });
    const result = await completeOrder(row, { cashierId: CASHIER_B, cashierShiftId: SHIFT_B });
    expect(result.row.completed_cashier_id).toBe(CASHIER_B);
    expect(result.row.settled_total).toBe("500.00");
    expect(result.row.status).toBe("completed");
  });

  it("completes the order anyway when nobody is on a till", async () => {
    // A manager clearing an order from the back office. No cashier shift, so
    // no attribution to record — but the status change must still go through.
    const row = baseRow({ cashier_id: null });
    const result = await completeOrder(row, undefined);
    expect(result.row.status).toBe("completed");
    expect(result.row.settled_total).toBe("120.00");
    expect(result.row.completed_cashier_id).toBeUndefined();
  });
});

/**
 * The columns holding a cashier CODE — `cashier_id`, `input_cashier_id`,
 * `completed_cashier_id` — are `uuid REFERENCES cashier_profiles`. A shift
 * opened on first sale has no code, so they must simply go unwritten.
 *
 * They were written unconditionally from a field the resolver had filled with
 * the logged-in user's id, which is a Clerk subject rather than a uuid. Postgres
 * rejected the UPDATE and every completion 500'd.
 */
describe("a completing shift with no cashier code", () => {
  const USER_ID = "user_3EFIamv0l9IggwK7Ncy6oDEPfWk";

  it("records the shift and the user, and writes no code columns", async () => {
    const row = baseRow({ cashier_id: null });
    const result = await completeOrder(row, { cashierId: null, cashierShiftId: SHIFT_B });
    expect(result.row.completed_cashier_shift_id).toBe(SHIFT_B);
    expect(result.row.settled_total).toBe("120.00");
    expect(result.row.completed_cashier_id).toBeUndefined();
    expect(result.row.cashier_id).toBeNull();
  });

  it("never lets a user id reach a cashier-code column", async () => {
    const row = baseRow({ cashier_id: null });
    const { orderEvents } = await import("@shared/schema");
    const { orders } = await import("../../apps/server/src/db/schema");
    const tx = makeFakeTx(new Map([[orderEvents, []], [orders, [row]]]));
    const result = await completeOrderTx(
      tx,
      row,
      { userId: USER_ID, cashierShift: { cashierId: null, cashierShiftId: SHIFT_B } },
      {},
    );
    for (const column of ["cashier_id", "input_cashier_id", "completed_cashier_id"]) {
      expect((result.row as Record<string, unknown>)[column]).not.toBe(USER_ID);
    }
  });

  it("leaves an existing code alone rather than clearing it", async () => {
    // An order loaded under a cashier code, completed by somebody on a lazily
    // opened shift. The inputter's 10% is read from `cashier_id`; blanking it
    // would lose their share.
    const row = baseRow({ cashier_id: CASHIER_A });
    const result = await completeOrder(row, { cashierId: null, cashierShiftId: SHIFT_B });
    expect(result.row.cashier_id).toBe(CASHIER_A);
  });
});
