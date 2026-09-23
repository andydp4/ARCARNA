/**
 * Owner bug: "when split X amount cash and Y amount credit, Y doesn't show up
 * in the credit list". Production showed both orders stored as cash + CARD —
 * the second split row came pre-filled with Card and was never changed.
 */
import { describe, expect, it } from "vitest";
import { freshSplitLegs, hasUnchosenMethod } from "../splitTender";

describe("split payment rows", () => {
  it("never pre-picks a method for the second row", () => {
    expect(freshSplitLegs()).toEqual([
      { method: "cash", amount: "" },
      { method: "", amount: "" },
    ]);
    expect(freshSplitLegs("cash")[1].method).toBe("");
  });

  it("carries over what the cashier had already chosen before switching Split on", () => {
    expect(freshSplitLegs("tick")[1].method).toBe("tick");
    expect(freshSplitLegs("card")[1].method).toBe("card");
  });

  it("ignores methods a split row cannot carry", () => {
    expect(freshSplitLegs("gift_card")[1].method).toBe("");
    expect(freshSplitLegs("personal_use")[1].method).toBe("");
  });

  it("flags a row with money on it but no method", () => {
    expect(hasUnchosenMethod([{ method: "cash", amount: "200" }, { method: "", amount: "50" }])).toBe(true);
    expect(hasUnchosenMethod([{ method: "cash", amount: "200" }, { method: "tick", amount: "50" }])).toBe(false);
    // An empty extra row is dropped at checkout, not an error.
    expect(hasUnchosenMethod([{ method: "cash", amount: "250" }, { method: "", amount: "" }])).toBe(false);
  });
});
