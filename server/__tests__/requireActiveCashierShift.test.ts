import { describe, expect, it } from "vitest";
import { validateSubmittedCashierShift } from "../services/cashierShiftGuards";

const ids = {
  cashierId: "11111111-1111-4111-8111-111111111111",
  shiftId: "22222222-2222-4222-8222-222222222222",
};

describe("validateSubmittedCashierShift", () => {
  it("trusts a submitted cashier shift pair only when the shift is open and matches", () => {
    const result = validateSubmittedCashierShift(
      { cashierId: ids.cashierId, cashierShiftId: ids.shiftId },
      { id: ids.shiftId, cashierId: ids.cashierId, status: "open" },
    );

    expect(result).toEqual({
      status: "trusted",
      context: { cashierId: ids.cashierId, cashierShiftId: ids.shiftId },
    });
  });

  it("rejects a submitted shift pair after the shift is closed", () => {
    const result = validateSubmittedCashierShift(
      { cashierId: ids.cashierId, cashierShiftId: ids.shiftId },
      { id: ids.shiftId, cashierId: ids.cashierId, status: "closed" },
    );

    expect(result).toMatchObject({
      status: "invalid",
      code: "CASHIER_SHIFT_INVALID",
    });
  });

  it("rejects a submitted shift pair that does not belong to the submitted cashier", () => {
    const result = validateSubmittedCashierShift(
      { cashierId: ids.cashierId, cashierShiftId: ids.shiftId },
      {
        id: ids.shiftId,
        cashierId: "33333333-3333-4333-8333-333333333333",
        status: "open",
      },
    );

    expect(result).toMatchObject({
      status: "invalid",
      code: "CASHIER_SHIFT_INVALID",
    });
  });

  it("does not treat body cashierId alone as a submitted shift pair", () => {
    expect(validateSubmittedCashierShift({ cashierId: ids.cashierId }, null)).toEqual({ status: "absent" });
  });
});
