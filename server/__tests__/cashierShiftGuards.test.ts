import { describe, expect, it } from "vitest";
import { resolveTrustedOfflineCashierShiftSnapshot } from "../services/cashierShiftGuards";

const shift = {
  id: "shift-1",
  cashierId: "cashier-1",
  openedByUserId: "user-1",
  openedAt: new Date("2026-07-14T09:00:00.000Z"),
  closedAt: new Date("2026-07-14T17:00:00.000Z"),
  status: "closed",
};

describe("resolveTrustedOfflineCashierShiftSnapshot", () => {
  it("does not trust raw cashier/shift body IDs from a live request", () => {
    const result = resolveTrustedOfflineCashierShiftSnapshot(
      { cashierId: "cashier-1", cashierShiftId: "shift-1" },
      shift,
      "user-1",
    );

    expect(result).toEqual({ trusted: false, reason: "not_offline_replay" });
  });

  it("rejects an offline replay for a shift opened by a different user", () => {
    const result = resolveTrustedOfflineCashierShiftSnapshot(
      {
        cashierId: "cashier-1",
        cashierShiftId: "shift-1",
        _offlineOrderReplay: true,
        _offlineQueuedAt: "2026-07-14T12:00:00.000Z",
      },
      shift,
      "user-2",
    );

    expect(result).toEqual({ trusted: false, reason: "opened_by_mismatch" });
  });

  it("rejects an offline replay queued outside the shift window", () => {
    const result = resolveTrustedOfflineCashierShiftSnapshot(
      {
        cashierId: "cashier-1",
        cashierShiftId: "shift-1",
        _offlineOrderReplay: true,
        _offlineQueuedAt: "2026-07-14T18:00:00.000Z",
      },
      shift,
      "user-1",
    );

    expect(result).toEqual({ trusted: false, reason: "outside_shift_window" });
  });

  it("trusts an authenticated offline replay queued during the same cashier shift", () => {
    const result = resolveTrustedOfflineCashierShiftSnapshot(
      {
        cashierId: "cashier-1",
        cashierShiftId: "shift-1",
        _offlineOrderReplay: true,
        _offlineQueuedAt: "2026-07-14T12:00:00.000Z",
      },
      shift,
      "user-1",
    );

    expect(result).toEqual({ trusted: true, cashierId: "cashier-1", cashierShiftId: "shift-1" });
  });
});
