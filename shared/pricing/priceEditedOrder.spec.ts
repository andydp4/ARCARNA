import { describe, expect, it } from "vitest";
import { PricingError, priceEditedOrder, type KeptDiscounts } from "./priceOrder";

const none: KeptDiscounts = { tier: null, promotion: null, pointsRedeemed: 0, pointsDiscount: 0 };
const line = (quantity: number, unitPrice: number) => ({ quantity, unitPrice });

describe("priceEditedOrder (v1.2 Phase 1B manager edits)", () => {
  it("prices new lines at the org rate with nothing to keep", () => {
    expect(priceEditedOrder({ lines: [line(3, 25)], taxRatePercent: 0, kept: none })).toMatchObject({
      subtotal: 75,
      vatAmount: 0,
      total: 75,
    });
    expect(priceEditedOrder({ lines: [line(1, 25)], taxRatePercent: 20, kept: none })).toMatchObject({
      vatRate: 20,
      vatAmount: 5,
      total: 30,
    });
  });

  it("keeps the tier % on the new subtotal", () => {
    const p = priceEditedOrder({
      lines: [line(3, 25)],
      taxRatePercent: 0,
      kept: { ...none, tier: { id: null, name: "Silver", percent: 10 } },
    });
    expect(p).toMatchObject({ subtotal: 75, tierDiscount: 7.5, total: 67.5, discountTotal: 7.5 });
    expect(p.tier?.percent).toBe(10);
  });

  it("re-applies a percentage promotion by its rule, capped by its maximum", () => {
    const promotion = {
      id: "p1",
      code: "TEN",
      name: "Ten",
      rule: { type: "percentage", value: "10", maxDiscount: "8" },
      storedDiscount: 5,
    };
    const p = priceEditedOrder({ lines: [line(4, 25)], taxRatePercent: 0, kept: { ...none, promotion } });
    expect(p.promoDiscount).toBe(8);
    expect(p.total).toBe(92);
  });

  it("keeps a fixed promotion, never more than what is left to discount", () => {
    const promotion = { id: "p1", code: "FIVE", name: "Five", rule: { type: "fixed", value: "5" }, storedDiscount: 5 };
    expect(priceEditedOrder({ lines: [line(1, 3)], taxRatePercent: 0, kept: { ...none, promotion } }).promoDiscount).toBe(3);
  });

  it("uses the amount the sale was given when the promotion has since been deleted", () => {
    const promotion = { id: "gone", code: "OLD", name: "Old", rule: null, storedDiscount: 4 };
    expect(priceEditedOrder({ lines: [line(2, 25)], taxRatePercent: 0, kept: { ...none, promotion } })).toMatchObject({
      promoDiscount: 4,
      total: 46,
    });
  });

  it("takes points off after VAT (owner Q2) and refuses an edit below their value", () => {
    const kept = { ...none, pointsRedeemed: 500, pointsDiscount: 5 };
    // £25 + 20% = £30 − £5 = £25.
    expect(priceEditedOrder({ lines: [line(1, 25)], taxRatePercent: 20, kept })).toMatchObject({
      vatAmount: 5,
      pointsDiscount: 5,
      pointsRedeemed: 500,
      total: 25,
    });
    expect(() => priceEditedOrder({ lines: [line(1, 4)], taxRatePercent: 0, kept })).toThrow(PricingError);
  });

  it("prices in pence, so no float drift reaches the total", () => {
    const p = priceEditedOrder({ lines: [line(3, 0.1), line(1, 19.99)], taxRatePercent: 17.5, kept: none });
    expect(p.subtotal).toBe(20.29);
    expect(p.vatAmount).toBe(3.55);
    expect(p.total).toBe(23.84);
  });
});
