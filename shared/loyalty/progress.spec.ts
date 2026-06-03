import { describe, expect, it } from "vitest";
import { computeTierProgress, pointsToDiscount } from "@shared/loyalty/progress";

const tiers = [
  { name: "Bronze", pointsRequired: 0 },
  { name: "Silver", pointsRequired: 200 },
  { name: "Gold", pointsRequired: 500 },
];

describe("computeTierProgress", () => {
  it("shows progress toward next tier", () => {
    const p = computeTierProgress(280, tiers);
    expect(p.currentTier?.name).toBe("Silver");
    expect(p.nextTier?.name).toBe("Gold");
    expect(p.pointsToNext).toBe(220);
    expect(p.percent).toBe(27);
  });

  it("returns 100% at max tier", () => {
    const p = computeTierProgress(600, tiers);
    expect(p.currentTier?.name).toBe("Gold");
    expect(p.nextTier).toBeNull();
    expect(p.percent).toBe(100);
  });

  it("handles just below tier threshold", () => {
    const p = computeTierProgress(199, tiers);
    expect(p.currentTier?.name).toBe("Bronze");
    expect(p.nextTier?.name).toBe("Silver");
    expect(p.pointsToNext).toBe(1);
  });
});

describe("pointsToDiscount", () => {
  it("converts points at default rate", () => {
    expect(pointsToDiscount(100, 0.01)).toBe(1);
    expect(pointsToDiscount(250, 0.01)).toBe(2.5);
  });
});
