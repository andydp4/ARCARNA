import { beforeEach, describe, expect, it } from "vitest";
import {
  createCashierShiftReplayToken,
  validateCashierShiftReplay,
  verifyCashierShiftReplayToken,
} from "../services/cashierShiftReplayToken";

const shift = {
  orgId: "00000000-0000-0000-0000-000000000001",
  cashierId: "00000000-0000-0000-0000-000000000002",
  id: "00000000-0000-0000-0000-000000000003",
  openedAt: new Date("2026-07-16T10:00:00.000Z"),
  closedAt: new Date("2026-07-16T11:00:00.000Z"),
  status: "closed",
  openedByUserId: "seed-cashier",
};

function token() {
  return createCashierShiftReplayToken({
    orgId: shift.orgId,
    cashierId: shift.cashierId,
    cashierShiftId: shift.id,
    openedAt: shift.openedAt.toISOString(),
    openedByUserId: shift.openedByUserId,
  });
}

describe("cashier shift replay tokens", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = "test_session_secret_at_least_32_chars";
  });

  it("verifies a token signed for the original shift context", () => {
    expect(verifyCashierShiftReplayToken(token())).toMatchObject({
      orgId: shift.orgId,
      cashierId: shift.cashierId,
      cashierShiftId: shift.id,
      openedByUserId: shift.openedByUserId,
    });
  });

  it("rejects closed-shift replay without a valid token", () => {
    const result = validateCashierShiftReplay({
      orgId: shift.orgId,
      userId: shift.openedByUserId,
      cashierId: shift.cashierId,
      cashierShiftId: shift.id,
      token: undefined,
      queuedAt: "2026-07-16T10:30:00.000Z",
      shift,
    });

    expect(result).toEqual({ ok: false, reason: "missing_or_invalid_token" });
  });

  it("accepts a signed replay queued during the original shift window", () => {
    const result = validateCashierShiftReplay({
      orgId: shift.orgId,
      userId: shift.openedByUserId,
      cashierId: shift.cashierId,
      cashierShiftId: shift.id,
      token: token(),
      queuedAt: "2026-07-16T10:30:00.000Z",
      shift,
    });

    expect(result).toMatchObject({
      ok: true,
      queuedAt: new Date("2026-07-16T10:30:00.000Z"),
      replayedToClosedShift: true,
    });
  });

  it("rejects replay timestamps after the shift closed", () => {
    const result = validateCashierShiftReplay({
      orgId: shift.orgId,
      userId: shift.openedByUserId,
      cashierId: shift.cashierId,
      cashierShiftId: shift.id,
      token: token(),
      queuedAt: "2026-07-16T11:05:00.000Z",
      shift,
    });

    expect(result).toEqual({ ok: false, reason: "queued_at_outside_shift" });
  });

  it("rejects replays by a different authenticated user", () => {
    const result = validateCashierShiftReplay({
      orgId: shift.orgId,
      userId: "other-user",
      cashierId: shift.cashierId,
      cashierShiftId: shift.id,
      token: token(),
      queuedAt: "2026-07-16T10:30:00.000Z",
      shift,
    });

    expect(result).toEqual({ ok: false, reason: "token_context_mismatch" });
  });
});

