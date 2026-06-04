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
  it("merges products in same category", () => {
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
});
