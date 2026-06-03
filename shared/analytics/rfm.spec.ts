import { describe, expect, it } from "vitest";
import { assignSegment, computeRfmScores, segmentCounts } from "@shared/analytics/rfm";

describe("assignSegment", () => {
  it("assigns New for single order with R=5", () => {
    expect(assignSegment(5, 1, 2, 1)).toBe("New");
  });

  it("assigns Champions for high R/F/M", () => {
    expect(assignSegment(5, 5, 5, 10)).toBe("Champions");
  });

  it("assigns At-Risk for low recency with good history", () => {
    expect(assignSegment(1, 4, 4, 8)).toBe("At-Risk");
  });

  it("assigns Lost for low R/F/M", () => {
    expect(assignSegment(1, 1, 1, 2)).toBe("Lost");
  });
});

describe("computeRfmScores", () => {
  it("returns empty for no customers", () => {
    expect(computeRfmScores([])).toEqual([]);
  });

  it("segments a mixed dataset", () => {
    const scores = computeRfmScores([
      { customerId: "a", orderCount: 20, totalSpent: 5000, recencyDays: 2 },
      { customerId: "b", orderCount: 1, totalSpent: 50, recencyDays: 1 },
      { customerId: "c", orderCount: 0, totalSpent: 0, recencyDays: null },
    ]);
    expect(scores).toHaveLength(3);
    expect(scores.find((s) => s.customerId === "b")?.segment).toBe("New");
    expect(scores.find((s) => s.customerId === "c")?.segment).toBe("Lost");
    const counts = segmentCounts(scores);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(3);
  });
});
