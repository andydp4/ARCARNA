import { describe, expect, it } from "vitest";
import { priceEditedOrder, priceOrder } from "./priceOrder";

const lines = [{ quantity: 2, unitPrice: 25 }];

describe("priceOrder with a delivery fee (v1.2.1)", () => {
  it("prices exactly as before when there is no fee", () => {
    const before = priceOrder({ lines, taxRatePercent: 20 });
    const none = priceOrder({ lines, taxRatePercent: 20, deliveryFee: 0 });
    expect(none).toEqual(before);
    expect(before.deliveryFee).toBe(0);
    expect(before.total).toBe(60);
  });

  it("adds the fee on top of the goods at 0% VAT", () => {
    const p = priceOrder({ lines, taxRatePercent: 0, deliveryFee: 3.5 });
    expect(p.subtotal).toBe(50);
    expect(p.deliveryFee).toBe(3.5);
    expect(p.vatAmount).toBe(0);
    expect(p.total).toBe(53.5);
  });

  it("charges VAT on the fee at the org rate", () => {
    const p = priceOrder({ lines, taxRatePercent: 20, deliveryFee: 3.5 });
    expect(p.vatAmount).toBe(10.7);
    expect(p.total).toBe(64.2);
  });

  it("never discounts the fee: tier and promotion come off the goods only", () => {
    const p = priceOrder({
      lines,
      taxRatePercent: 0,
      deliveryFee: 4,
      customer: { loyaltyPoints: 1000 },
      tiers: [{ id: "t", name: "Gold", pointsRequired: 500, discountPercentage: 10 }],
      promotion: {
        id: "p",
        code: "HALF",
        name: "Half off",
        type: "percentage",
        value: 50,
        startDate: new Date(Date.now() - 1000),
        endDate: new Date(Date.now() + 100000),
        isActive: 1,
      },
    });
    expect(p.tierDiscount).toBe(5);
    expect(p.promoDiscount).toBe(25);
    expect(p.netAfterDiscounts).toBe(20);
    expect(p.total).toBe(24);
  });

  it("lets points pay towards the fee, but not beyond what is charged", () => {
    const p = priceOrder({
      lines: [{ quantity: 1, unitPrice: 2 }],
      taxRatePercent: 0,
      deliveryFee: 3,
      customer: { loyaltyPoints: 1000 },
      points: { points: 500, redemptionRate: 0.01, minRedeemPoints: 100, balance: 1000 },
    });
    expect(p.pointsDiscount).toBe(5);
    expect(p.total).toBe(0);
  });

  it("the breakdown adds up: subtotal − discounts + fee + VAT − points = total", () => {
    const p = priceOrder({ lines: [{ quantity: 3, unitPrice: 7.99 }], taxRatePercent: 20, deliveryFee: 2.99 });
    const sum = p.subtotal - p.tierDiscount - p.promoDiscount + p.deliveryFee + p.vatAmount - p.pointsDiscount;
    expect(Math.round(sum * 100) / 100).toBe(p.total);
  });

  it("a manager's edit keeps the fee it is given", () => {
    const edited = priceEditedOrder({
      lines: [{ quantity: 1, unitPrice: 25 }],
      taxRatePercent: 0,
      kept: { tier: null, promotion: null, pointsRedeemed: 0, pointsDiscount: 0 },
      deliveryFee: 3.5,
    });
    expect(edited.deliveryFee).toBe(3.5);
    expect(edited.total).toBe(28.5);
  });
});
