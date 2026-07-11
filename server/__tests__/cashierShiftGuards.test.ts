import { describe, expect, it } from "vitest";
import {
  OFFLINE_ORDER_QUEUED_AT,
  OFFLINE_ORDER_REPLAY_FLAG,
  resolveSubmittedCashierShift,
  type CashierShiftForSubmission,
} from "../services/cashierShiftGuards";

const baseShift: CashierShiftForSubmission = {
  id: "shift-1",
  cashierId: "cashier-1",
  status: "open",
  openedAt: new Date("2026-07-11T10:00:00.000Z"),
  closedAt: null,
};

describe("resolveSubmittedCashierShift", () => {
  it("leaves server-side open-shift resolution alone when no shift id is submitted", () => {
    expect(resolveSubmittedCashierShift({ cashierId: "cashier-1" }, null)).toEqual({ kind: "none" });
  });

  it("accepts a submitted shift only when it matches the open same-cashier shift", () => {
    expect(
      resolveSubmittedCashierShift(
        { cashierId: "cashier-1", cashierShiftId: "shift-1" },
        baseShift,
      ),
    ).toEqual({
      kind: "accepted",
      cashierId: "cashier-1",
      cashierShiftId: "shift-1",
      replayedOfflineOrder: false,
    });
  });

  it("rejects a closed submitted shift for normal online orders", () => {
    const closedShift = {
      ...baseShift,
      status: "closed",
      closedAt: new Date("2026-07-11T11:00:00.000Z"),
    };

    const result = resolveSubmittedCashierShift(
      { cashierId: "cashier-1", cashierShiftId: "shift-1" },
      closedShift,
      new Date("2026-07-11T12:00:00.000Z"),
    );

    expect(result).toMatchObject({
      kind: "rejected",
      status: 409,
      code: "CASHIER_SHIFT_STALE",
    });
  });

  it("accepts a queued offline replay whose queued timestamp falls inside the closed shift", () => {
    const closedShift = {
      ...baseShift,
      status: "closed",
      closedAt: new Date("2026-07-11T11:00:00.000Z"),
    };

    expect(
      resolveSubmittedCashierShift(
        {
          cashierId: "cashier-1",
          cashierShiftId: "shift-1",
          [OFFLINE_ORDER_REPLAY_FLAG]: true,
          [OFFLINE_ORDER_QUEUED_AT]: "2026-07-11T10:30:00.000Z",
        },
        closedShift,
        new Date("2026-07-11T12:00:00.000Z"),
      ),
    ).toEqual({
      kind: "accepted",
      cashierId: "cashier-1",
      cashierShiftId: "shift-1",
      replayedOfflineOrder: true,
    });
  });

  it("rejects a queued offline replay timestamp outside the submitted shift window", () => {
    const closedShift = {
      ...baseShift,
      status: "closed",
      closedAt: new Date("2026-07-11T11:00:00.000Z"),
    };

    const result = resolveSubmittedCashierShift(
      {
        cashierId: "cashier-1",
        cashierShiftId: "shift-1",
        [OFFLINE_ORDER_REPLAY_FLAG]: true,
        [OFFLINE_ORDER_QUEUED_AT]: "2026-07-11T11:30:00.000Z",
      },
      closedShift,
      new Date("2026-07-11T12:00:00.000Z"),
    );

    expect(result).toMatchObject({
      kind: "rejected",
      status: 409,
      code: "CASHIER_SHIFT_REPLAY_INVALID",
    });
  });
});
