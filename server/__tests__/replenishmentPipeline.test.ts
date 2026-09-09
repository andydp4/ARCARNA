import { describe, it, expect } from "vitest";
import {
  computeRequiredQty,
  groupPurchaseLinesBySupplier,
  roundBuyQtyToPack,
  type PurchaseLineRequest,
} from "../services/replenishmentMath";
import { isStorableQuantity } from "@shared/quantity";

const SUPPLIER_A = "11111111-1111-1111-1111-111111111111";
const SUPPLIER_B = "22222222-2222-2222-2222-222222222222";
const LOCATION_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const LOCATION_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PRODUCT_1 = "c1111111-1111-1111-1111-111111111111";
const PRODUCT_2 = "c2222222-2222-2222-2222-222222222222";

function line(overrides: Partial<PurchaseLineRequest> = {}): PurchaseLineRequest {
  return {
    supplierId: SUPPLIER_A,
    locationId: LOCATION_A,
    productId: PRODUCT_1,
    quantity: 10,
    ...overrides,
  };
}

describe("computeRequiredQty", () => {
  it("returns the gap to target coverage when nothing is on order", () => {
    const result = computeRequiredQty({
      stock: 10,
      velocityPerDay: 5,
      targetCoverageDays: 14,
      onOrderQty: 0,
    });

    expect(result.targetStock).toBe(70);
    expect(result.grossRequiredQty).toBe(60);
    expect(result.requiredQty).toBe(60);
  });

  it("nets off stock already on order so a drafted order clears its recommendation", () => {
    const result = computeRequiredQty({
      stock: 10,
      velocityPerDay: 5,
      targetCoverageDays: 14,
      onOrderQty: 60,
    });

    expect(result.grossRequiredQty).toBe(60);
    expect(result.requiredQty).toBe(0);
  });

  it("reduces rather than clears the requirement when on-order only partly covers it", () => {
    const result = computeRequiredQty({
      stock: 10,
      velocityPerDay: 5,
      targetCoverageDays: 14,
      onOrderQty: 25,
    });

    expect(result.grossRequiredQty).toBe(60);
    expect(result.requiredQty).toBe(35);
  });

  it("never goes negative when on-order exceeds the shortfall", () => {
    const result = computeRequiredQty({
      stock: 10,
      velocityPerDay: 5,
      targetCoverageDays: 14,
      onOrderQty: 500,
    });

    expect(result.requiredQty).toBe(0);
  });

  it("treats overstocked products as requiring nothing", () => {
    const result = computeRequiredQty({
      stock: 200,
      velocityPerDay: 5,
      targetCoverageDays: 14,
      onOrderQty: 0,
    });

    expect(result.grossRequiredQty).toBe(0);
    expect(result.requiredQty).toBe(0);
  });

  it("rounds fractional velocity up so target coverage is never short", () => {
    const result = computeRequiredQty({
      stock: 0,
      velocityPerDay: 0.5,
      targetCoverageDays: 7,
      onOrderQty: 0,
    });

    expect(result.targetStock).toBe(4);
    expect(result.requiredQty).toBe(4);
  });

  it("ignores a negative on-order quantity rather than inflating the requirement", () => {
    const result = computeRequiredQty({
      stock: 10,
      velocityPerDay: 5,
      targetCoverageDays: 14,
      onOrderQty: -20,
    });

    expect(result.requiredQty).toBe(60);
  });

  it("rounds off float64 subtraction noise instead of returning 1.3499999999999996", () => {
    // Reproduces the exact ARC-002 bug: stock 0.65, target coverage netting to
    // 5, 3 units already on order. Plain float subtraction (5 - 0.65 - 3)
    // yields 1.3499999999999996 in JS, which shared/quantity.ts's
    // positiveQuantity schema rejects ("Quantity supports up to 3 decimal
    // places") the moment a purchase draft is raised from the recommendation.
    expect(5 - 0.65 - 3).not.toBe(1.35); // sanity check the raw float bug still reproduces
    const result = computeRequiredQty({
      stock: 0.65,
      velocityPerDay: 1,
      targetCoverageDays: 5,
      onOrderQty: 3,
    });

    expect(result.targetStock).toBe(5);
    expect(result.requiredQty).toBe(1.35);
    expect(isStorableQuantity(result.requiredQty)).toBe(true);
    expect(isStorableQuantity(result.grossRequiredQty)).toBe(true);
  });
});

describe("roundBuyQtyToPack", () => {
  it("rounds a raw buy quantity up to a whole unit before pack rounding", () => {
    // The ARC-002 scenario end-to-end: computeRequiredQty's noisy output feeds
    // straight into the pack-rounding step that used to hand the API a
    // 3-decimal-place-violating quantity like 1.3499999999999996.
    const { requiredQty } = computeRequiredQty({
      stock: 0.65,
      velocityPerDay: 1,
      targetCoverageDays: 5,
      onOrderQty: 3,
    });

    const roundedBuyQty = roundBuyQtyToPack(requiredQty, 1);
    expect(roundedBuyQty).toBe(2);
    expect(isStorableQuantity(roundedBuyQty)).toBe(true);
  });

  it("returns zero for a non-positive quantity", () => {
    expect(roundBuyQtyToPack(0, 1)).toBe(0);
    expect(roundBuyQtyToPack(-5, 1)).toBe(0);
  });

  it("rounds a whole-unit quantity up to the next full pack", () => {
    expect(roundBuyQtyToPack(7, 6)).toBe(12);
    expect(roundBuyQtyToPack(6, 6)).toBe(6);
  });

  it("previously returned the raw float unchanged when packSize <= 1 — now it is whole and storable", () => {
    const noisy = 1.3499999999999996;
    const rounded = roundBuyQtyToPack(noisy, 1);
    expect(rounded).toBe(2);
    expect(isStorableQuantity(rounded)).toBe(true);
  });
});

describe("groupPurchaseLinesBySupplier", () => {
  it("collapses lines for one supplier and location into a single draft", () => {
    const groups = groupPurchaseLinesBySupplier([
      line({ productId: PRODUCT_1, quantity: 10 }),
      line({ productId: PRODUCT_2, quantity: 4 }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].supplierId).toBe(SUPPLIER_A);
    expect(groups[0].locationId).toBe(LOCATION_A);
    expect(groups[0].items).toHaveLength(2);
  });

  it("splits by supplier", () => {
    const groups = groupPurchaseLinesBySupplier([
      line({ supplierId: SUPPLIER_A }),
      line({ supplierId: SUPPLIER_B }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.supplierId).sort()).toEqual([SUPPLIER_A, SUPPLIER_B].sort());
  });

  it("splits by location, since a draft receives into exactly one location", () => {
    const groups = groupPurchaseLinesBySupplier([
      line({ locationId: LOCATION_A }),
      line({ locationId: LOCATION_B }),
    ]);

    expect(groups).toHaveLength(2);
  });

  it("sums duplicate products within a group instead of emitting two lines", () => {
    const groups = groupPurchaseLinesBySupplier([
      line({ productId: PRODUCT_1, quantity: 10 }),
      line({ productId: PRODUCT_1, quantity: 5 }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(1);
    expect(groups[0].items[0].quantity).toBe(15);
  });

  it("carries supplier cost and SKU through to the draft line", () => {
    const groups = groupPurchaseLinesBySupplier([
      line({ estimatedCost: 12.5, supplierSku: "SUP-123" }),
    ]);

    expect(groups[0].items[0].estimatedCost).toBe(12.5);
    expect(groups[0].items[0].supplierSku).toBe("SUP-123");
  });

  it("keeps cost and SKU from whichever duplicate line carried them", () => {
    const groups = groupPurchaseLinesBySupplier([
      line({ productId: PRODUCT_1, quantity: 2 }),
      line({ productId: PRODUCT_1, quantity: 3, estimatedCost: 9.99, supplierSku: "SUP-9" }),
    ]);

    expect(groups[0].items[0].quantity).toBe(5);
    expect(groups[0].items[0].estimatedCost).toBe(9.99);
    expect(groups[0].items[0].supplierSku).toBe("SUP-9");
  });

  it("returns nothing for an empty selection", () => {
    expect(groupPurchaseLinesBySupplier([])).toEqual([]);
  });

  it("gives each group only its own recommendations, never another supplier's", () => {
    const groups = groupPurchaseLinesBySupplier([
      line({ supplierId: SUPPLIER_A, recommendation: { tag: "a" } }),
      line({ supplierId: SUPPLIER_B, productId: PRODUCT_2, recommendation: { tag: "b" } }),
    ]);

    const bySupplier = new Map(groups.map((g) => [g.supplierId, g]));
    expect(bySupplier.get(SUPPLIER_A)!.recommendations).toEqual([{ tag: "a" }]);
    expect(bySupplier.get(SUPPLIER_B)!.recommendations).toEqual([{ tag: "b" }]);
  });

  it("accumulates every recommendation that fed one group", () => {
    const groups = groupPurchaseLinesBySupplier([
      line({ productId: PRODUCT_1, recommendation: { tag: "one" } }),
      line({ productId: PRODUCT_2, recommendation: { tag: "two" } }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].recommendations).toEqual([{ tag: "one" }, { tag: "two" }]);
  });

  it("records no provenance when the caller sent none", () => {
    const groups = groupPurchaseLinesBySupplier([line()]);
    expect(groups[0].recommendations).toEqual([]);
  });
});
