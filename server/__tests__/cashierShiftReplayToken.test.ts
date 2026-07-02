import { describe, expect, it } from "vitest";
import {
  createCashierShiftReplayToken,
  verifyCashierShiftReplayToken,
} from "../services/cashierShiftReplayToken";

const payload = {
  orgId: "11111111-1111-1111-1111-111111111111",
  cashierId: "22222222-2222-2222-2222-222222222222",
  shiftId: "33333333-3333-3333-3333-333333333333",
  openedAt: "2026-07-02T10:00:00.000Z",
};

describe("cashier shift replay tokens", () => {
  it("verifies a token for the exact cashier shift payload", () => {
    const token = createCashierShiftReplayToken(payload);

    expect(verifyCashierShiftReplayToken(token, payload)).toBe(true);
  });

  it("rejects a token replayed against a different shift", () => {
    const token = createCashierShiftReplayToken(payload);

    expect(
      verifyCashierShiftReplayToken(token, {
        ...payload,
        shiftId: "44444444-4444-4444-4444-444444444444",
      }),
    ).toBe(false);
  });

  it("rejects a token with a tampered signature", () => {
    const token = createCashierShiftReplayToken(payload);
    const tampered = token.replace(/.$/, (char) => (char === "a" ? "b" : "a"));

    expect(verifyCashierShiftReplayToken(tampered, payload)).toBe(false);
  });
});
