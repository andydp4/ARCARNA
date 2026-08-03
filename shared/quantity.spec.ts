import { describe, it, expect } from "vitest";
import {
  QUANTITY_MAX,
  formatQuantity,
  isStorableQuantity,
  nonNegativeQuantity,
  parseQuantityInput,
  positiveQuantity,
  roundQuantity,
} from "./quantity";

describe("quantity: rounding to the stored scale", () => {
  it("keeps three decimal places", () => {
    expect(roundQuantity(0.4)).toBe(0.4);
    expect(roundQuantity(1.5)).toBe(1.5);
    expect(roundQuantity(0.125)).toBe(0.125);
  });

  it("rounds off what numeric(14,3) could not hold", () => {
    // The read/modify/write hazard: this is what 0.1 + 0.2 actually produces.
    expect(roundQuantity(0.30000000000000004)).toBe(0.3);
    expect(roundQuantity(1.23456)).toBe(1.235);
  });

  it("recognises values that need no rounding", () => {
    expect(isStorableQuantity(0.4)).toBe(true);
    expect(isStorableQuantity(1.2345)).toBe(false);
    expect(isStorableQuantity(Number.NaN)).toBe(false);
    expect(isStorableQuantity(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("quantity: parsing what someone types", () => {
  it("accepts the fractions that used to vanish", () => {
    // parseInt("0.4") is 0, the line reads as empty and the product is dropped
    // from the screen with no error — the reported bug.
    expect(parseQuantityInput("0.4")).toBe(0.4);
    expect(parseQuantityInput("1.5")).toBe(1.5);
    expect(parseQuantityInput(" 2.25 ")).toBe(2.25);
  });

  it("still accepts whole numbers", () => {
    expect(parseQuantityInput("3")).toBe(3);
  });

  it("rejects what is not a usable quantity", () => {
    for (const bad of ["", "   ", "abc", "0", "-1", "NaN", "Infinity"]) {
      expect(parseQuantityInput(bad), `${bad} must not parse`).toBeNull();
    }
    expect(parseQuantityInput(String(QUANTITY_MAX + 1))).toBeNull();
  });

  it("rounds an over-precise entry rather than refusing it", () => {
    expect(parseQuantityInput("0.4004")).toBe(0.4);
  });
});

describe("quantity: schemas", () => {
  it("accepts a fractional sale quantity", () => {
    expect(positiveQuantity.safeParse(0.4).success).toBe(true);
    expect(positiveQuantity.safeParse(1.5).success).toBe(true);
  });

  it("rejects zero and negatives where a quantity must be positive", () => {
    expect(positiveQuantity.safeParse(0).success).toBe(false);
    expect(positiveQuantity.safeParse(-1).success).toBe(false);
  });

  it("allows zero where zero is meaningful", () => {
    expect(nonNegativeQuantity.safeParse(0).success).toBe(true);
  });

  it("rejects more precision than the column stores", () => {
    const res = positiveQuantity.safeParse(1.2345);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.errors[0].message).toMatch(/decimal places/);
    }
  });

  it("rejects a quantity past the column's range", () => {
    // The class of defect that reached a Drizzle insert failure and returned
    // the SQL statement to the caller.
    expect(positiveQuantity.safeParse(Number.MAX_SAFE_INTEGER).success).toBe(false);
    expect(positiveQuantity.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
    expect(positiveQuantity.safeParse(Number.NaN).success).toBe(false);
  });
});

describe("quantity: display", () => {
  it("does not pad whole numbers with decimals", () => {
    expect(formatQuantity(2)).toBe("2");
    expect(formatQuantity(0.4)).toBe("0.4");
    expect(formatQuantity(1.5)).toBe("1.5");
  });
});
