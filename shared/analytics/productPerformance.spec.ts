import { describe, expect, it } from "vitest";
import { rankProducts, type ProductPerformance } from "./productPerformance";

const products: ProductPerformance[] = [
  { productId: "cheap", name: "Volume seller", quantity: 100, revenue: 200, grossProfit: 20, missingCostUnits: 0 },
  { productId: "premium", name: "Premium seller", quantity: 2, revenue: 1000, grossProfit: 100, missingCostUnits: 0 },
  { productId: "profitable", name: "Profit leader", quantity: 5, revenue: 500, grossProfit: 400, missingCostUnits: 0 },
  { productId: "unknown", name: "Cost missing", quantity: 1, revenue: 2000, grossProfit: null, missingCostUnits: 1 },
  { productId: "loss", name: "Loss maker", quantity: 1, revenue: 10, grossProfit: -50, missingCostUnits: 0 },
];

describe("product rankings", () => {
  it("finds different revenue, profit and quantity leaders across the entire catalogue", () => {
    expect(rankProducts(products, "quantity", 1)[0].productId).toBe("cheap");
    expect(rankProducts(products, "revenue", 1)[0].productId).toBe("unknown");
    expect(rankProducts(products, "grossProfit", 1)[0].productId).toBe("profitable");
    expect(products[0].productId).toBe("cheap");
  });

  it("keeps losses in the profit ranking and excludes missing costs rather than assuming zero", () => {
    expect(rankProducts(products, "grossProfit", 10).map((p) => p.productId))
      .toEqual(["profitable", "premium", "cheap", "loss"]);
  });

  it("finds revenue leaders outside the previous ten biggest quantity sellers", () => {
    const highVolume = Array.from({ length: 10 }, (_, i) => ({
      ...products[0], productId: `volume-${i}`, name: `Volume ${i}`,
    }));
    expect(rankProducts([...highVolume, products[1]], "revenue", 5)[0].productId).toBe("premium");
  });

  it("keeps identically named products separate and orders ties consistently", () => {
    const tied = ["b", "a"].map((productId) => ({ ...products[0], productId }));
    expect(rankProducts(tied, "revenue", 5).map((p) => p.productId)).toEqual(["a", "b"]);
  });

  it("returns an empty ranking for an empty period or entirely unknown profit", () => {
    expect(rankProducts([], "revenue", 5)).toEqual([]);
    expect(rankProducts([products[3]], "grossProfit", 5)).toEqual([]);
  });
});
