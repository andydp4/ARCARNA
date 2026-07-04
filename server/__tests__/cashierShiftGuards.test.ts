import { describe, expect, it } from "vitest";
import {
  canCloseCashierShift,
  canUseCashierShift,
  signCashierShiftReplayToken,
  verifyCashierShiftReplayToken,
  type CashierShiftReplayClaims,
} from "../services/cashierShiftGuards";

const claims: CashierShiftReplayClaims = {
  orgId: "11111111-1111-1111-1111-111111111111",
  cashierId: "22222222-2222-2222-2222-222222222222",
  shiftId: "33333333-3333-3333-3333-333333333333",
  openedAt: "2026-07-04T10:00:00.000Z",
};

describe("cashierShiftGuards", () => {
  it("accepts a signed offline replay token for the exact shift context", () => {
    const token = signCashierShiftReplayToken(claims, "test-secret");

    expect(verifyCashierShiftReplayToken(token, claims, "test-secret")).toBe(true);
  });

  it("rejects tampered or mismatched offline replay tokens", () => {
    const token = signCashierShiftReplayToken(claims, "test-secret");

    expect(verifyCashierShiftReplayToken(`${token}x`, claims, "test-secret")).toBe(false);
    expect(
      verifyCashierShiftReplayToken(
        token,
        { ...claims, shiftId: "44444444-4444-4444-4444-444444444444" },
        "test-secret",
      ),
    ).toBe(false);
  });

  it("limits non-manager shift use and close actions to the user who opened the shift", () => {
    const shift = { openedByUserId: "cashier-a" };

    expect(canUseCashierShift({ role: "CASHIER", userId: "cashier-a" }, shift)).toBe(true);
    expect(canCloseCashierShift({ role: "CASHIER", userId: "cashier-a" }, shift)).toBe(true);
    expect(canUseCashierShift({ role: "CASHIER", userId: "cashier-b" }, shift)).toBe(false);
    expect(canCloseCashierShift({ role: "CASHIER", userId: "cashier-b" }, shift)).toBe(false);
    expect(canUseCashierShift({ role: "MANAGER", userId: "manager-1" }, shift)).toBe(true);
    expect(canCloseCashierShift({ role: "ADMIN", userId: "admin-1" }, shift)).toBe(true);
  });
});
