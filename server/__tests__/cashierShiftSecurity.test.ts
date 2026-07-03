import { describe, expect, it } from "vitest";
import {
  canActorCloseCashierShift,
  isSubmittedCashierShiftUsable,
  validateShiftCommissionPayment,
} from "../services/cashierShiftGuards";

describe("cashier shift security guards", () => {
  it("does not trust stale submitted cashier shift IDs", () => {
    expect(
      isSubmittedCashierShiftUsable(
        { cashierId: "cashier-a", status: "closed" },
        "cashier-a",
      ),
    ).toBe(false);

    expect(
      isSubmittedCashierShiftUsable(
        { cashierId: "cashier-a", status: "open" },
        "cashier-a",
      ),
    ).toBe(true);
  });

  it("allows cashiers to close only shifts they opened", () => {
    expect(canActorCloseCashierShift("CASHIER", "user-a", { openedByUserId: "user-a" } as any)).toBe(true);
    expect(canActorCloseCashierShift("CASHIER", "user-a", { openedByUserId: "user-b" } as any)).toBe(false);
    expect(canActorCloseCashierShift("MANAGER", "user-a", { openedByUserId: "user-b" } as any)).toBe(true);
  });

  it("rejects shift commission payments for the wrong cashier", () => {
    expect(
      validateShiftCommissionPayment({
        requestedCashierId: "cashier-a",
        summaryCashierId: "cashier-b",
        commissionAmount: 25,
        alreadyPaid: 0,
        amountPaid: 10,
      }),
    ).toMatchObject({ ok: false, code: "SHIFT_CASHIER_MISMATCH" });
  });

  it("rejects duplicate or excessive shift commission payments", () => {
    expect(
      validateShiftCommissionPayment({
        requestedCashierId: "cashier-a",
        summaryCashierId: "cashier-a",
        commissionAmount: 25,
        alreadyPaid: 25,
        amountPaid: 1,
      }),
    ).toMatchObject({ ok: false, code: "COMMISSION_OVERPAID" });

    expect(
      validateShiftCommissionPayment({
        requestedCashierId: "cashier-a",
        summaryCashierId: "cashier-a",
        commissionAmount: 25,
        alreadyPaid: 10,
        amountPaid: 15,
      }),
    ).toEqual({ ok: true });
  });
});
