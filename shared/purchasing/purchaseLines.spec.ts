import { describe, it, expect } from "vitest";
import {
  usableCost,
  resolvePurchaseUnitCost,
  canEditPurchaseLines,
  overDeliveryExcess,
} from "./purchaseLines";

describe("usableCost", () => {
  it("accepts positive numbers and numeric strings", () => {
    expect(usableCost(0.11)).toBe(0.11);
    expect(usableCost("0.11")).toBe(0.11);
  });

  it("treats zero, blanks and junk as no cost", () => {
    expect(usableCost(0)).toBeNull();
    expect(usableCost("0.00")).toBeNull();
    expect(usableCost("")).toBeNull();
    expect(usableCost(null)).toBeNull();
    expect(usableCost(undefined)).toBeNull();
    expect(usableCost("abc")).toBeNull();
    expect(usableCost(-1)).toBeNull();
  });
});

describe("resolvePurchaseUnitCost", () => {
  it("falls back to the product card cost when the supplier link has none — the £0 PO bug", () => {
    expect(resolvePurchaseUnitCost({ supplierCost: null, productCost: "0.11" })).toEqual({
      unitCost: 0.11,
      source: "product",
    });
  });

  it("prefers the supplier's price over the product card", () => {
    expect(resolvePurchaseUnitCost({ supplierCost: "0.10", productCost: "0.11" })).toEqual({
      unitCost: 0.1,
      source: "supplier",
    });
  });

  it("prefers a cost typed on the line over both", () => {
    expect(
      resolvePurchaseUnitCost({ lineCost: 0.09, supplierCost: "0.10", productCost: "0.11" }),
    ).toEqual({ unitCost: 0.09, source: "line" });
  });

  it("skips a zero supplier cost rather than pricing the order at nothing", () => {
    expect(resolvePurchaseUnitCost({ supplierCost: "0", productCost: "0.11" }).source).toBe("product");
  });

  it("returns no cost when nothing anywhere has one", () => {
    expect(resolvePurchaseUnitCost({ productCost: "0" })).toEqual({ unitCost: null, source: null });
  });
});

describe("canEditPurchaseLines", () => {
  it("allows edits while drafting and reviewing", () => {
    expect(canEditPurchaseLines("draft", 0)).toBe(true);
    expect(canEditPurchaseLines("reviewed", 0)).toBe(true);
  });

  it("allows an approved order to be amended until the first receipt is booked", () => {
    expect(canEditPurchaseLines("approved", 0)).toBe(true);
    expect(canEditPurchaseLines("approved", 1)).toBe(false);
  });

  it("never allows edits once receiving has started, finished or the draft is cancelled", () => {
    expect(canEditPurchaseLines("partially_received", 0)).toBe(false);
    expect(canEditPurchaseLines("fully_received", 0)).toBe(false);
    expect(canEditPurchaseLines("cancelled", 0)).toBe(false);
  });
});

describe("overDeliveryExcess", () => {
  it("is zero when the delivery fits the order", () => {
    expect(
      overDeliveryExcess({ ordered: 3864, alreadyReceived: 0, pendingOnOtherReceipts: 0, requested: 3864 }),
    ).toBe(0);
  });

  it("is the extra units when the supplier sent more than ordered", () => {
    expect(
      overDeliveryExcess({ ordered: 3864, alreadyReceived: 0, pendingOnOtherReceipts: 0, requested: 10000 }),
    ).toBe(6136);
  });

  it("measures against what is still outstanding, not the original order", () => {
    expect(
      overDeliveryExcess({ ordered: 100, alreadyReceived: 60, pendingOnOtherReceipts: 30, requested: 20 }),
    ).toBe(10);
  });

  it("does not drift on fractional quantities", () => {
    expect(
      overDeliveryExcess({ ordered: 1.2, alreadyReceived: 0.4, pendingOnOtherReceipts: 0, requested: 1.1 }),
    ).toBe(0.3);
  });
});
