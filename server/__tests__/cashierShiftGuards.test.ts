import { describe, expect, it } from "vitest";
import { evaluateSubmittedCashierShift, type SubmittedCashierShift } from "../services/cashierShiftGuards";

const baseShift: SubmittedCashierShift = {
  id: "shift-1",
  cashierId: "cashier-1",
  status: "open",
  openedAt: new Date("2026-07-13T09:00:00.000Z"),
  closedAt: null,
};

describe("evaluateSubmittedCashierShift", () => {
  it("accepts a submitted pair only while the shift is open for live sales", () => {
    expect(
      evaluateSubmittedCashierShift({ cashierId: "cashier-1", cashierShiftId: "shift-1" }, baseShift),
    ).toEqual({
      accepted: true,
      cashierId: "cashier-1",
      cashierShiftId: "shift-1",
      shouldTouchShift: true,
    });
  });

  it("rejects a closed shift without offline replay evidence", () => {
    const shift = {
      ...baseShift,
      status: "closed",
      closedAt: new Date("2026-07-13T10:00:00.000Z"),
    };

    expect(
      evaluateSubmittedCashierShift({ cashierId: "cashier-1", cashierShiftId: "shift-1" }, shift),
    ).toMatchObject({
      accepted: false,
      reason: "submitted cashier shift is not open for this sale",
    });
  });

  it("accepts a closed shift for offline replay queued during that shift", () => {
    const shift = {
      ...baseShift,
      status: "closed",
      closedAt: new Date("2026-07-13T10:00:00.000Z"),
    };

    expect(
      evaluateSubmittedCashierShift(
        {
          cashierId: "cashier-1",
          cashierShiftId: "shift-1",
          _offlineOrderReplay: true,
          _offlineQueuedAt: "2026-07-13T09:30:00.000Z",
        },
        shift,
      ),
    ).toEqual({
      accepted: true,
      cashierId: "cashier-1",
      cashierShiftId: "shift-1",
      shouldTouchShift: false,
    });
  });

  it("rejects offline replay when the queued timestamp is outside the shift window", () => {
    const shift = {
      ...baseShift,
      status: "closed",
      closedAt: new Date("2026-07-13T10:00:00.000Z"),
    };

    expect(
      evaluateSubmittedCashierShift(
        {
          cashierId: "cashier-1",
          cashierShiftId: "shift-1",
          _offlineOrderReplay: true,
          _offlineQueuedAt: "2026-07-13T10:30:00.000Z",
        },
        shift,
      ),
    ).toMatchObject({
      accepted: false,
      reason: "submitted cashier shift is not open for this sale",
    });
  });

  it("rejects mismatched cashier and shift pairs", () => {
    expect(
      evaluateSubmittedCashierShift({ cashierId: "cashier-2", cashierShiftId: "shift-1" }, baseShift),
    ).toMatchObject({
      accepted: false,
      reason: "cashier shift does not match the submitted cashier",
    });
  });
});
