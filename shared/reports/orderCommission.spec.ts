import { describe, expect, it } from "vitest";
import {
  apportionOverheadsByDay,
  buildOrderCommission,
  buildShiftCommission,
  distributeOverheadShare,
  type CommissionOrderInput,
} from "./orderCommission";

const A = "cashier-a";
const B = "cashier-b";

function order(overrides: Partial<CommissionOrderInput> = {}): CommissionOrderInput {
  return {
    orderId: "o1",
    paidContribution: 200,
    stockCost: 100,
    orderExpenses: 0,
    overheadShare: 0,
    refunds: 0,
    completerCashierId: A,
    inputterCashierId: A,
    ...overrides,
  };
}

const base = { ...order(), soldOn: "2026-08-25" };

describe("the 90/10 split", () => {
  it("pays £9 and £1 out of a £10 pool on £100 of margin", () => {
    const result = buildOrderCommission(order({ completerCashierId: B, inputterCashierId: A }), 10);

    expect(result.margin).toBe(100);
    expect(result.pool).toBe(10);
    expect(result.entries).toEqual([
      { cashierId: B, role: "completer", sharePercent: 90, amount: 9 },
      { cashierId: A, role: "inputter", sharePercent: 10, amount: 1 },
    ]);
  });

  it("gives one person the whole pool when they loaded and completed it", () => {
    const result = buildOrderCommission(order(), 10);

    expect(result.entries).toEqual([
      { cashierId: A, role: "completer", sharePercent: 100, amount: 10 },
    ]);
  });

  it("gives the completer the whole pool on a web order, which has no inputter", () => {
    const result = buildOrderCommission(order({ inputterCashierId: null }), 10);

    expect(result.entries).toEqual([
      { cashierId: A, role: "completer", sharePercent: 100, amount: 10 },
    ]);
  });

  it("uses the completer's rate, never the inputter's", () => {
    // B completes on 25%, A loaded on whatever A is on. The pool is 25% of the
    // margin and A's tenth is a tenth of that — not a tenth priced at A's rate.
    const result = buildShiftCommission(
      [order({ completerCashierId: B, inputterCashierId: A })],
      new Map([
        [B, 25],
        [A, 10],
      ]),
      10,
    );

    expect(result.perOrder[0].pool).toBe(25);
    expect(result.perOrder[0].entries).toEqual([
      { cashierId: B, role: "completer", sharePercent: 90, amount: 22.5 },
      { cashierId: A, role: "inputter", sharePercent: 10, amount: 2.5 },
    ]);
  });

  it("always splits the pool exactly, whatever the rounding", () => {
    // £33.33 of margin at 10% is a £3.33 pool; a tenth of that is £0.333.
    for (const margin of [33.33, 0.07, 12.34, 99.99, 1.05]) {
      const result = buildOrderCommission(
        order({ paidContribution: margin, stockCost: 0, completerCashierId: B, inputterCashierId: A }),
        10,
      );
      const summed = result.entries.reduce((sum, e) => sum + e.amount, 0);
      expect(Math.round(summed * 100) / 100).toBe(result.pool);
    }
  });
});

describe("what earns nothing", () => {
  it("pays nothing on a below-cost sale, and never a negative amount", () => {
    const result = buildOrderCommission(order({ paidContribution: 50, stockCost: 100 }), 10);

    expect(result.margin).toBe(-50);
    expect(result.pool).toBe(0);
    expect(result.entries).toEqual([]);
  });

  it("pays nothing on an unpaid credit sale", () => {
    // The goods are gone and the invoice is raised, but no money has arrived.
    // Commission follows the money.
    const result = buildOrderCommission(order({ paidContribution: 0 }), 10);

    expect(result.entries).toEqual([]);
  });

  it("pays nothing on an excluded order, however profitable it looks", () => {
    const result = buildOrderCommission(order({ excluded: true }), 10);

    expect(result.pool).toBe(0);
    expect(result.entries).toEqual([]);
  });

  it("pays nobody when nobody completed the order", () => {
    const result = buildOrderCommission(order({ completerCashierId: null }), 10);

    expect(result.entries).toEqual([]);
  });

  it("does not let one loss-making order eat the commission on a good one", () => {
    // The shift-level figure floored the SUM, so a £50 loss cancelled £50 of
    // someone else's profit. Each order is now floored on its own.
    const { total } = buildShiftCommission(
      [
        order({ orderId: "good", paidContribution: 200, stockCost: 100 }),
        order({ orderId: "bad", paidContribution: 50, stockCost: 100 }),
      ],
      new Map([[A, 10]]),
      10,
    );

    expect(total).toBe(10);
  });
});

describe("apportioning the day's expenses", () => {
  it("splits the shift's allocation in proportion to what each order took", () => {
    const shares = distributeOverheadShare(
      [
        { orderId: "a", paidContribution: 75 },
        { orderId: "b", paidContribution: 25 },
      ],
      40,
    );

    expect(shares.get("a")).toBe(30);
    expect(shares.get("b")).toBe(10);
  });

  it("gives an unpaid credit sale no share, because it brought nothing in", () => {
    const shares = distributeOverheadShare(
      [
        { orderId: "paid", paidContribution: 100 },
        { orderId: "tick", paidContribution: 0 },
      ],
      20,
    );

    expect(shares.get("paid")).toBe(20);
    expect(shares.get("tick")).toBe(0);
  });

  it("apportions the whole allocation and not a penny more or less", () => {
    const shares = distributeOverheadShare(
      [
        { orderId: "a", paidContribution: 33.33 },
        { orderId: "b", paidContribution: 33.33 },
        { orderId: "c", paidContribution: 33.34 },
      ],
      10,
    );

    const summed = [...shares.values()].reduce((sum, v) => sum + v, 0);
    expect(Math.round(summed * 100) / 100).toBe(10);
  });

  it("charges nothing to a shift that took no money", () => {
    const shares = distributeOverheadShare([{ orderId: "a", paidContribution: 0 }], 25);

    expect(shares.get("a")).toBe(0);
  });
});

describe("a shift that spans midnight", () => {
  it("charges each day's expenses against that day's orders only", () => {
    // Monday was quiet and cheap; Tuesday busy and expensive. Apportioning the
    // shift's total in one go would charge Monday's sale a share of Tuesday's
    // overheads, and the cashier would lose commission for working a late shift.
    const shares = apportionOverheadsByDay(
      [
        { ...base, orderId: "mon", paidContribution: 100, soldOn: "2026-08-24" },
        { ...base, orderId: "tue-a", paidContribution: 100, soldOn: "2026-08-25" },
        { ...base, orderId: "tue-b", paidContribution: 300, soldOn: "2026-08-25" },
      ],
      new Map([
        ["2026-08-24", 10],
        ["2026-08-25", 40],
      ]),
    );

    expect(shares.get("mon")).toBe(10);
    expect(shares.get("tue-a")).toBe(10);
    expect(shares.get("tue-b")).toBe(30);
  });

  it("apportions every day's allocation in full", () => {
    const shares = apportionOverheadsByDay(
      [
        { ...base, orderId: "a", paidContribution: 33.33, soldOn: "2026-08-24" },
        { ...base, orderId: "b", paidContribution: 66.67, soldOn: "2026-08-24" },
        { ...base, orderId: "c", paidContribution: 10, soldOn: "2026-08-25" },
      ],
      new Map([
        ["2026-08-24", 7.77],
        ["2026-08-25", 3.33],
      ]),
    );

    const monday = (shares.get("a") ?? 0) + (shares.get("b") ?? 0);
    expect(Math.round(monday * 100) / 100).toBe(7.77);
    expect(shares.get("c")).toBe(3.33);
  });
});
