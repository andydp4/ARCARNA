import { describe, expect, it } from "vitest";
import { validateSubmittedCashierShift } from "../services/cashierShiftGuards";

describe("validateSubmittedCashierShift", () => {
  it("accepts a submitted cashier and shift pair only when the shift is open", () => {
    expect(
      validateSubmittedCashierShift("cashier-1", "shift-1", {
        id: "shift-1",
        cashierId: "cashier-1",
        status: "open",
      }),
    ).toEqual({
      kind: "valid",
      context: { cashierId: "cashier-1", cashierShiftId: "shift-1" },
    });
  });

  it("rejects submitted closed shifts so sales cannot attach to frozen summaries", () => {
    expect(
      validateSubmittedCashierShift("cashier-1", "shift-1", {
        id: "shift-1",
        cashierId: "cashier-1",
        status: "closed",
      }),
    ).toEqual({
      kind: "invalid",
      status: 409,
      code: "CASHIER_SHIFT_STALE",
      message: "Submitted cashier shift is no longer open. Start a new cashier shift before syncing this sale.",
    });
  });

  it("rejects mismatched cashier and shift pairs", () => {
    expect(
      validateSubmittedCashierShift("cashier-2", "shift-1", {
        id: "shift-1",
        cashierId: "cashier-1",
        status: "open",
      }),
    ).toMatchObject({
      kind: "invalid",
      status: 409,
      code: "CASHIER_SHIFT_INVALID",
    });
  });

  it("rejects submitted shift IDs that are not found in the org", () => {
    expect(validateSubmittedCashierShift("cashier-1", "shift-1", null)).toMatchObject({
      kind: "invalid",
      status: 409,
      code: "CASHIER_SHIFT_INVALID",
    });
  });

  it("allows callers without submitted shift context to use the normal open-shift lookup", () => {
    expect(validateSubmittedCashierShift("cashier-1", undefined, null)).toEqual({ kind: "missing" });
    expect(validateSubmittedCashierShift(undefined, "shift-1", null)).toEqual({ kind: "missing" });
  });
});
