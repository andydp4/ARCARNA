import { describe, it, expect } from "vitest";
import {
  overDeliveredLines,
  overDeliveryKey,
  parseCostInput,
  pendingLineChange,
} from "../purchaseDraftEdits";

describe("parseCostInput", () => {
  it("reads pounds with up to two decimals, with or without a £", () => {
    expect(parseCostInput("0.11")).toEqual({ ok: true, value: 0.11 });
    expect(parseCostInput("£1100")).toEqual({ ok: true, value: 1100 });
    expect(parseCostInput(" £ 2.5 ")).toEqual({ ok: true, value: 2.5 });
  });

  it("treats blank as 'no cost of its own'", () => {
    expect(parseCostInput("")).toEqual({ ok: true, value: null });
    expect(parseCostInput("   ")).toEqual({ ok: true, value: null });
  });

  it("refuses values that used to be accepted and then silently ignored or rounded to £0", () => {
    for (const bad of ["0", "0.00", "0.004", "1e3", "-1", "0,11", "abc", "1.234"]) {
      expect(parseCostInput(bad)).toEqual({ ok: false });
    }
  });
});

describe("pendingLineChange", () => {
  const saved = { quantity: 3864, estimatedCost: null };

  it("reports the typed quantity — the 10,000 that used to be lost on Approve", () => {
    expect(pendingLineChange(saved, "10000", undefined)).toEqual({
      quantity: 10000,
      estimatedCost: undefined,
      invalid: null,
    });
  });

  it("reports nothing when the typed values match what is saved", () => {
    expect(pendingLineChange({ quantity: 5, estimatedCost: "0.50" }, "5", "0.5")).toEqual({
      quantity: undefined,
      estimatedCost: undefined,
      invalid: null,
    });
  });

  it("clears a line cost when the field is emptied", () => {
    expect(pendingLineChange({ quantity: 5, estimatedCost: "0.50" }, undefined, "").estimatedCost).toBeNull();
  });

  it("flags an invalid field instead of saving it", () => {
    expect(pendingLineChange(saved, "-2", undefined).invalid).toBe("quantity");
    expect(pendingLineChange(saved, undefined, "0").invalid).toBe("cost");
  });
});

describe("over-delivery confirmation key", () => {
  const lines = [
    { id: "a", remaining: 3864, received: "10000" },
    { id: "b", remaining: 10, received: "10" },
  ];

  it("lists only the lines over what is outstanding, with the excess", () => {
    expect(overDeliveredLines(lines).map((l) => [l.id, l.excess])).toEqual([["a", 6136]]);
  });

  it("changes when an over-delivered quantity changes, so an old tick lapses", () => {
    const before = overDeliveryKey(lines);
    const typo = overDeliveryKey([{ ...lines[0], received: "100000" }, lines[1]]);
    expect(typo).not.toBe(before);
  });

  it("changes when another line goes over, so a tick never covers a line the manager did not see", () => {
    const before = overDeliveryKey(lines);
    const second = overDeliveryKey([lines[0], { ...lines[1], received: "12" }]);
    expect(second).not.toBe(before);
  });

  it("is empty when nothing is over", () => {
    expect(overDeliveryKey([{ id: "a", remaining: 5, received: "5" }])).toBe("");
  });
});
