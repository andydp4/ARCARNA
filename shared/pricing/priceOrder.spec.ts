import { describe, expect, it } from "vitest";
import {
  PricingError,
  pointsEarnedFor,
  priceOrder,
  tierForPoints,
  type PricingPromotion,
  type PricingTier,
} from "./priceOrder";

const now = new Date("2026-09-23T12:00:00Z");
const tiers: PricingTier[] = [
  { id: "bronze", name: "Bronze", pointsRequired: 0, discountPercentage: "0" },
  { id: "silver", name: "Silver", pointsRequired: 500, discountPercentage: "10.00" },
  { id: "gold", name: "Gold", pointsRequired: 1000, discountPercentage: "15" },
];
const promo = (over: Partial<PricingPromotion> = {}): PricingPromotion => ({
  id: "p1",
  code: "SAVE5",
  name: "Save five",
  type: "fixed",
  value: "5.00",
  minPurchase: null,
  maxDiscount: null,
  startDate: "2026-09-01T00:00:00Z",
  endDate: "2026-09-30T23:59:59Z",
  isActive: 1,
  usageLimit: null,
  usageCount: 0,
  tierRequired: null,
  ...over,
});
const lines = [
  { quantity: 2, unitPrice: 10 },
  { quantity: 1, unitPrice: 30 },
]; // £50

function refusal(fn: () => unknown): PricingError {
  try {
    fn();
  } catch (e) {
    if (e instanceof PricingError) return e;
    throw e;
  }
  throw new Error("expected a PricingError");
}

describe("priceOrder", () => {
  it("a plain sale is the lines plus VAT, nothing else", () => {
    const p = priceOrder({ lines, taxRatePercent: 20 });
    expect(p).toMatchObject({ subtotal: 50, tierDiscount: 0, promoDiscount: 0, vatRate: 20, vatAmount: 10, total: 60 });
  });

  it("at 0% VAT (not registered) there is no VAT and the total is the net", () => {
    const p = priceOrder({ lines, taxRatePercent: 0 });
    expect(p.vatAmount).toBe(0);
    expect(p.total).toBe(50);
  });

  it("applies the customer's tier %, derived from their balance", () => {
    const p = priceOrder({ lines, taxRatePercent: 0, customer: { loyaltyPoints: 600 }, tiers });
    expect(p.tier).toEqual({ id: "silver", name: "Silver", percent: 10 });
    expect(p.tierDiscount).toBe(5);
    expect(p.total).toBe(45);
    expect(p.discountTotal).toBe(5);
  });

  it("tier and promo both come off the subtotal and VAT is on what is left", () => {
    const p = priceOrder({
      lines,
      taxRatePercent: 20,
      customer: { loyaltyPoints: 600 },
      tiers,
      promotion: promo({ type: "percentage", value: "10" }),
      now,
    });
    expect(p.tierDiscount).toBe(5);
    expect(p.promoDiscount).toBe(5);
    expect(p.netAfterDiscounts).toBe(40);
    expect(p.vatAmount).toBe(8);
    expect(p.total).toBe(48);
  });

  it("caps a promotion at its max discount and never below zero", () => {
    const capped = priceOrder({ lines, taxRatePercent: 0, promotion: promo({ type: "percentage", value: "50", maxDiscount: "7.50" }), now });
    expect(capped.promoDiscount).toBe(7.5);
    const huge = priceOrder({ lines, taxRatePercent: 0, promotion: promo({ value: "80" }), now });
    expect(huge.promoDiscount).toBe(50);
    expect(huge.total).toBe(0);
  });

  it("refuses an expired, not-started, switched-off or used-up promotion", () => {
    expect(refusal(() => priceOrder({ lines, taxRatePercent: 0, promotion: promo({ endDate: "2026-09-01T00:00:00Z" }), now })).code).toBe("PROMO_EXPIRED");
    expect(refusal(() => priceOrder({ lines, taxRatePercent: 0, promotion: promo({ startDate: "2026-10-01T00:00:00Z" }), now })).code).toBe("PROMO_NOT_STARTED");
    expect(refusal(() => priceOrder({ lines, taxRatePercent: 0, promotion: promo({ isActive: 0 }), now })).code).toBe("PROMO_NOT_ACTIVE");
    expect(refusal(() => priceOrder({ lines, taxRatePercent: 0, promotion: promo({ usageLimit: 3, usageCount: 3 }), now })).code).toBe("PROMO_USED_UP");
  });

  it("refuses a promotion below its minimum spend (goods before discounts)", () => {
    const e = refusal(() => priceOrder({ lines, taxRatePercent: 0, promotion: promo({ minPurchase: "50.01" }), now }));
    expect(e.code).toBe("PROMO_MIN_SPEND");
    expect(e.message).toContain("£50.01");
    expect(priceOrder({ lines, taxRatePercent: 0, promotion: promo({ minPurchase: "50" }), now }).promoDiscount).toBe(5);
  });

  it("a members' promotion needs that tier or above", () => {
    const gold = promo({ tierRequired: "silver" });
    expect(refusal(() => priceOrder({ lines, taxRatePercent: 0, tiers, promotion: gold, now })).code).toBe("PROMO_CUSTOMER_REQUIRED");
    expect(refusal(() => priceOrder({ lines, taxRatePercent: 0, tiers, customer: { loyaltyPoints: 10 }, promotion: gold, now })).code).toBe("PROMO_TIER_REQUIRED");
    expect(priceOrder({ lines, taxRatePercent: 0, tiers, customer: { loyaltyPoints: 1200 }, promotion: gold, now }).promoDiscount).toBe(5);
  });

  it("refuses promotion types that have no pricing rule rather than guessing", () => {
    expect(refusal(() => priceOrder({ lines, taxRatePercent: 0, promotion: promo({ type: "bogo" }), now })).code).toBe("PROMO_TYPE_UNSUPPORTED");
    expect(refusal(() => priceOrder({ lines, taxRatePercent: 0, promotion: promo({ type: "points" }), now })).code).toBe("PROMO_TYPE_UNSUPPORTED");
  });

  it("Q2: points come off what the customer pays after VAT", () => {
    const p = priceOrder({
      lines,
      taxRatePercent: 20,
      customer: { loyaltyPoints: 600 },
      points: { points: 500, redemptionRate: 0.01, minRedeemPoints: 100, balance: 600 },
    });
    // £50 net + £10 VAT = £60; 500 points = £5 off that — VAT stays on £50.
    expect(p.vatAmount).toBe(10);
    expect(p.pointsDiscount).toBe(5);
    expect(p.pointsRedeemed).toBe(500);
    expect(p.total).toBe(55);
  });

  it("refuses points that are below the minimum, more than held, or worth more than the sale", () => {
    const base = { lines, taxRatePercent: 0, customer: { loyaltyPoints: 10_000 } };
    expect(refusal(() => priceOrder({ ...base, points: { points: 50, redemptionRate: 0.01, minRedeemPoints: 100, balance: 10_000 } })).code).toBe("POINTS_BELOW_MINIMUM");
    expect(refusal(() => priceOrder({ ...base, points: { points: 700, redemptionRate: 0.01, minRedeemPoints: 100, balance: 600 } })).code).toBe("POINTS_INSUFFICIENT");
    expect(refusal(() => priceOrder({ ...base, points: { points: 6000, redemptionRate: 0.01, minRedeemPoints: 100, balance: 10_000 } })).code).toBe("POINTS_EXCEED_TOTAL");
    expect(refusal(() => priceOrder({ lines, taxRatePercent: 0, points: { points: 100, redemptionRate: 0.01, minRedeemPoints: 100, balance: 100 } })).code).toBe("POINTS_CUSTOMER_REQUIRED");
    // Exactly the total is allowed: a sale paid entirely in points.
    expect(priceOrder({ ...base, points: { points: 5000, redemptionRate: 0.01, minRedeemPoints: 100, balance: 10_000 } }).total).toBe(0);
  });

  it("loyalty is earned on what was paid, after every discount", () => {
    const p = priceOrder({
      lines,
      taxRatePercent: 0,
      customer: { loyaltyPoints: 600 },
      tiers,
      points: { points: 500, redemptionRate: 0.01, minRedeemPoints: 100, balance: 600 },
    });
    // £50 − £5 tier − £5 points = £40 paid.
    expect(p.total).toBe(40);
    expect(p.pointsEarned).toBe(40);
    expect(p.discountTotal).toBe(10);
  });

  it("works in pence: no float drift reaches a total", () => {
    const p = priceOrder({ lines: [{ quantity: 3, unitPrice: 0.1 }, { quantity: 1, unitPrice: 1.005 }], taxRatePercent: 20 });
    expect(p.subtotal).toBe(1.31);
    expect(p.vatAmount).toBe(0.26);
    expect(p.total).toBe(1.57);
    expect(pointsEarnedFor(19.99)).toBe(19);
    expect(pointsEarnedFor(20)).toBe(20);
  });

  it("weights: 0.4 of a £2.99 item is 120p", () => {
    expect(priceOrder({ lines: [{ quantity: 0.4, unitPrice: 2.99 }], taxRatePercent: 0 }).total).toBe(1.2);
  });

  it("tierForPoints picks the highest tier reached", () => {
    expect(tierForPoints(999, tiers)?.id).toBe("silver");
    expect(tierForPoints(1000, tiers)?.id).toBe("gold");
    expect(tierForPoints(5, [])).toBeNull();
  });
});
