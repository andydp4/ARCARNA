import { describe, expect, it } from "vitest";
import { marginPercent, marginPercentLabel, minPriceLabel } from "../productPriceColumns";

describe("products table: Min and Margin % columns", () => {
  it("Min shows the stored minimum or that it follows the sale price", () => {
    expect(minPriceLabel("4.5")).toBe("£4.50");
    expect(minPriceLabel("0")).toBe("£0.00");
    expect(minPriceLabel(null)).toBe("Follows price");
    expect(minPriceLabel("")).toBe("Follows price");
  });
  it("Margin % only where cost is known, never from a £0 cost", () => {
    expect(marginPercent("10", "4")).toBeCloseTo(60);
    expect(marginPercentLabel("10", "4")).toBe("60.0%");
    expect(marginPercentLabel("10", "0")).toBe("—");
    expect(marginPercentLabel("10", null)).toBe("—");
    expect(marginPercentLabel("0", "4")).toBe("—");
    expect(marginPercentLabel("4", "5")).toBe("-25.0%");
  });
});
