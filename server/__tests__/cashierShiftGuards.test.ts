import { describe, expect, it } from "vitest";
import {
  signCashierShiftReplayToken,
  verifyCashierShiftReplayToken,
  type CashierShiftReplayClaims,
} from "../services/cashierShiftGuards";

const secret = "test-secret-at-least-32-characters";

const claims: CashierShiftReplayClaims = {
  orgId: "11111111-1111-4111-8111-111111111111",
  cashierId: "22222222-2222-4222-8222-222222222222",
  cashierShiftId: "33333333-3333-4333-8333-333333333333",
  openedAt: "2026-07-07T10:00:00.000Z",
};

describe("cashier shift replay tokens", () => {
  it("verifies the signed cashier shift snapshot issued by the server", () => {
    const token = signCashierShiftReplayToken(claims, secret);

    expect(verifyCashierShiftReplayToken(claims, token, secret)).toBe(true);
  });

  it("rejects a token replayed for a different org/cashier/shift", () => {
    const token = signCashierShiftReplayToken(claims, secret);

    expect(
      verifyCashierShiftReplayToken(
        { ...claims, orgId: "44444444-4444-4444-8444-444444444444" },
        token,
        secret,
      ),
    ).toBe(false);
    expect(
      verifyCashierShiftReplayToken(
        { ...claims, cashierId: "55555555-5555-4555-8555-555555555555" },
        token,
        secret,
      ),
    ).toBe(false);
    expect(
      verifyCashierShiftReplayToken(
        { ...claims, cashierShiftId: "66666666-6666-4666-8666-666666666666" },
        token,
        secret,
      ),
    ).toBe(false);
  });

  it("rejects missing or malformed replay tokens", () => {
    expect(verifyCashierShiftReplayToken(claims, null, secret)).toBe(false);
    expect(verifyCashierShiftReplayToken(claims, "not-a-token", secret)).toBe(false);
    expect(verifyCashierShiftReplayToken(claims, "v1.bad-signature", secret)).toBe(false);
  });
});
