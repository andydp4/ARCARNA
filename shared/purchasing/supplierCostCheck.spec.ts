import { describe, expect, it } from "vitest";
import { checkSupplierCost } from "./supplierCostCheck";

describe("checkSupplierCost", () => {
  it("does not flag a gap of exactly 2%", () => {
    const r = checkSupplierCost("1.02", "1.00");
    expect(r.status).toBe("match");
    expect(r.flagged).toBe(false);
    expect(r.diffPercent).toBe(2);
  });

  it("flags a gap just over 2% in either direction", () => {
    expect(checkSupplierCost("1.03", "1.00")).toMatchObject({ status: "differs", flagged: true, diffPercent: 3 });
    expect(checkSupplierCost("0.97", "1.00")).toMatchObject({ status: "differs", flagged: true, diffPercent: -3 });
    // 2.04% over on a £4.90 card.
    expect(checkSupplierCost("5.00", "4.90").flagged).toBe(true);
  });

  it("treats equal prices as a match", () => {
    expect(checkSupplierCost(12.5, "12.50")).toMatchObject({ status: "match", flagged: false, diffPercent: 0 });
  });

  it("flags a missing supplier price, a missing card cost, or both", () => {
    expect(checkSupplierCost(null, "1.00")).toMatchObject({ status: "missing-supplier", flagged: true, diffPercent: null });
    expect(checkSupplierCost("1.00", "0")).toMatchObject({ status: "missing-card", flagged: true });
    expect(checkSupplierCost("", undefined)).toMatchObject({ status: "missing-both", flagged: true });
  });
});
