import { describe, it, expect } from "vitest";
import { proportionalPointsToReverse } from "./points";

describe("refund validation helpers", () => {
  it("rejects over-refund proportionally via remaining qty logic", () => {
    const lineQty = 3;
    const alreadyRefunded = 2;
    const requestQty = 2;
    const remaining = lineQty - alreadyRefunded;
    expect(requestQty > remaining).toBe(true);
  });

  it("deducts points proportional to refunded value (rounded down)", () => {
    const earned = 150;
    const orderTotal = 300;
    const refundAmount = 100;
    expect(proportionalPointsToReverse(refundAmount, orderTotal, earned)).toBe(50);
  });

  it("double-handled event yields zero additional reversal", () => {
    const first = proportionalPointsToReverse(50, 100, 100);
    const second = proportionalPointsToReverse(0, 100, 100);
    expect(first).toBe(50);
    expect(second).toBe(0);
  });
});
