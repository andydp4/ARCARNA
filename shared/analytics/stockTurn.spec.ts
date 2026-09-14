import { describe, expect, it } from "vitest";
import {
  aggregateStockTurnByCategory,
  classifyDaysOfStock,
  computeCategoryStockTurn,
  productCategoryFromSku,
} from "./stockTurn";

describe("productCategoryFromSku", () => {
  it("uses prefix before hyphen", () => {
    expect(productCategoryFromSku("BEV-001")).toBe("Bev");
  });

  it("falls back to General", () => {
    expect(productCategoryFromSku("")).toBe("General");
  });
});

describe("classifyDaysOfStock", () => {
  it("flags slow movers over 90 days", () => {
    expect(classifyDaysOfStock(120)).toBe("slow");
    expect(classifyDaysOfStock(45)).toBe("watch");
    expect(classifyDaysOfStock(10)).toBe("healthy");
  });
});

describe("computeCategoryStockTurn", () => {
  it("handles zero sales with stock on hand", () => {
    const row = computeCategoryStockTurn({
      category: "Bev",
      unitsSold: 0,
      avgStock: 50,
      windowDays: 90,
    });
    expect(row.daysOfStock).toBe(999);
    expect(row.status).toBe("slow");
  });

  it("computes turn when sales exist", () => {
    const row = computeCategoryStockTurn({
      category: "Bev",
      unitsSold: 90,
      avgStock: 30,
      windowDays: 90,
    });
    expect(row.dailySalesRate).toBe(1);
    expect(row.daysOfStock).toBe(30);
    expect(row.turnRate).toBe(3);
    expect(row.status).toBe("watch");
  });
});

describe("aggregateStockTurnByCategory", () => {
  it("merges products in same category (SKU-prefix fallback when no real category given)", () => {
    const rows = aggregateStockTurnByCategory(
      [
        { productId: "BEV-1", unitsSold: 10, avgStock: 5 },
        { productId: "BEV-2", unitsSold: 20, avgStock: 5 },
      ],
      90,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].unitsSold).toBe(30);
    expect(rows[0].avgStock).toBe(10);
  });

  // ARC-045: category grouping must use the real product category, not the
  // SKU prefix — two products from unrelated SKU ranges but the same real
  // category (e.g. "Beverages") should merge; two products sharing a SKU
  // prefix but different real categories should NOT merge.
  it("groups by the real category, not the SKU prefix, when a category is given", () => {
    const rows = aggregateStockTurnByCategory(
      [
        { productId: "ZZZ-1", unitsSold: 10, avgStock: 5, category: "Beverages" },
        { productId: "AAA-9", unitsSold: 20, avgStock: 5, category: "Beverages" },
        { productId: "BEV-2", unitsSold: 5, avgStock: 2, category: "Snacks" },
      ],
      90,
    );
    const beverages = rows.find((r) => r.category === "Beverages");
    const snacks = rows.find((r) => r.category === "Snacks");
    expect(beverages?.unitsSold).toBe(30);
    expect(beverages?.avgStock).toBe(10);
    expect(snacks?.unitsSold).toBe(5);
    expect(rows).toHaveLength(2);
  });

  it("falls back to the SKU-derived label only for a product with no category set", () => {
    const rows = aggregateStockTurnByCategory(
      [
        { productId: "BEV-1", unitsSold: 10, avgStock: 5, category: null },
        { productId: "BEV-2", unitsSold: 5, avgStock: 5, category: "" },
      ],
      90,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("Bev");
  });
});
