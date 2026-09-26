import { describe, expect, it } from "vitest";
import { bulkMinFor, bulkMinPreview, bulkMinRequestSchema, describeBulkMinRule } from "./bulkMinPrice";

const widget = { id: "w", name: "Widget", defaultSalePrice: "10.00", minPrice: null, costPrice: "4.00" };

describe('bulk "Set minimum price"', () => {
  it("follow the sale price clears the stored minimum", () => {
    expect(bulkMinFor({ ...widget, minPrice: "8.00" }, { kind: "follow" })).toEqual({ newMin: null, skipped: null });
  });
  it("sale price − x%", () => {
    expect(bulkMinFor(widget, { kind: "sale_minus_pct", percent: 15 })).toEqual({ newMin: 8.5, skipped: null });
    expect(bulkMinFor({ ...widget, defaultSalePrice: "3.33" }, { kind: "sale_minus_pct", percent: 10 }).newMin).toBe(3);
  });
  it("cost + x%, skipped when no cost is set", () => {
    expect(bulkMinFor(widget, { kind: "cost_plus_pct", percent: 25 })).toEqual({ newMin: 5, skipped: null });
    expect(bulkMinFor({ ...widget, costPrice: "0" }, { kind: "cost_plus_pct", percent: 25 }).skipped).toBe("NO_COST");
    expect(bulkMinFor({ ...widget, costPrice: null }, { kind: "cost_plus_pct", percent: 25 }).skipped).toBe("NO_COST");
  });
  it("a fixed £, skipped when above the sale price", () => {
    expect(bulkMinFor(widget, { kind: "fixed", amount: 7 })).toEqual({ newMin: 7, skipped: null });
    expect(bulkMinFor(widget, { kind: "fixed", amount: 12 }).skipped).toBe("MIN_ABOVE_SALE");
    expect(bulkMinFor(widget, { kind: "cost_plus_pct", percent: 200 }).skipped).toBe("MIN_ABOVE_SALE");
  });
  it("the preview says what changes", () => {
    const rows = bulkMinPreview(
      [widget, { ...widget, id: "x", name: "Already", minPrice: "9.00" }, { ...widget, id: "y", name: "No cost", costPrice: null }],
      { kind: "sale_minus_pct", percent: 10 },
    );
    expect(rows.map((r) => [r.productId, r.oldMin, r.newMin, r.changed, r.skipped])).toEqual([
      ["w", null, 9, true, null],
      ["x", 9, 9, false, null],
      ["y", null, 9, true, null],
    ]);
  });
  it("the request is validated", () => {
    expect(bulkMinRequestSchema.safeParse({ productIds: [], rule: { kind: "follow" } }).success).toBe(false);
    expect(bulkMinRequestSchema.safeParse({ productIds: ["not-a-uuid"], rule: { kind: "follow" } }).success).toBe(false);
    expect(
      bulkMinRequestSchema.safeParse({ productIds: ["7f0c1d64-3c8e-4f27-9d7b-2c0a4f1e9b11"], rule: { kind: "sale_minus_pct", percent: 120 } }).success,
    ).toBe(false);
    expect(describeBulkMinRule({ kind: "cost_plus_pct", percent: 30 })).toBe("cost +30%");
  });
  it("cost + 0% is refused: the till shows the minimum, so it would show the cost", () => {
    const ids = ["7f0c1d64-3c8e-4f27-9d7b-2c0a4f1e9b11"];
    expect(bulkMinRequestSchema.safeParse({ productIds: ids, rule: { kind: "cost_plus_pct", percent: 0 } }).success).toBe(false);
    expect(bulkMinRequestSchema.safeParse({ productIds: ids, rule: { kind: "cost_plus_pct", percent: 0.5 } }).success).toBe(false);
    expect(bulkMinRequestSchema.safeParse({ productIds: ids, rule: { kind: "cost_plus_pct", percent: 1 } }).success).toBe(true);
  });
});
