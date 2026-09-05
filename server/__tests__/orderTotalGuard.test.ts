/**
 * An order may never total less than zero.
 *
 * Giving money back is a refund — a separate path with its own controls and its
 * own audit trail. A negative order is the same payout with none of them, and
 * nothing stopped one: no lower bound in Zod, no check on the column, no guard
 * in the route.
 *
 * Zero stays legal on purpose: personal use is a real, recorded, zero-total
 * order. And a below-cost sale is untouched — its total is positive and only
 * its margin is negative, so clearing dead stock still works.
 */
import { describe, expect, it } from "vitest";
import { insertOrderSchema, commissionRateSchema } from "@shared/schema";
import { buildOrderCommission } from "@shared/reports/orderCommission";

const base = {
  orgId: "00000000-0000-4000-8000-000000000001",
  paymentMethod: "cash",
};

describe("order totals", () => {
  it("refuses a negative total", () => {
    const result = insertOrderSchema.safeParse({ ...base, total: -5 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toMatch(/less than zero/i);
    }
  });

  it("allows zero, because personal use is a real order", () => {
    expect(insertOrderSchema.safeParse({ ...base, total: 0 }).success).toBe(true);
  });

  it("allows an ordinary positive total", () => {
    expect(insertOrderSchema.safeParse({ ...base, total: 12.5 }).success).toBe(true);
  });

  it("still allows a below-cost sale, which pays no commission rather than being blocked", () => {
    // £40 of stock sold for £25 to clear it. A legitimate markdown, not a
    // negative order.
    expect(insertOrderSchema.safeParse({ ...base, total: 25 }).success).toBe(true);

    const commission = buildOrderCommission(
      {
        orderId: "o1",
        paidContribution: 25,
        stockCost: 40,
        orderExpenses: 0,
        overheadShare: 0,
        refunds: 0,
        completerCashierId: "cashier-a",
        inputterCashierId: null,
      },
      10,
    );
    expect(commission.margin).toBe(-15);
    expect(commission.entries).toEqual([]);
  });
});

describe("commission rates", () => {
  it("accepts any agreed rate, not just the quick picks", () => {
    for (const rate of [0, 10, 12, 12.5, 25, 33.33, 100]) {
      expect(commissionRateSchema.safeParse(rate).success).toBe(true);
    }
  });

  it("refuses a rate that is not a rate", () => {
    expect(commissionRateSchema.safeParse(-1).success).toBe(false);
    expect(commissionRateSchema.safeParse(101).success).toBe(false);
  });
});
