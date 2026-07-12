import { describe, expect, it } from "vitest";
import { shouldTrustSubmittedCashierShift } from "../services/cashierShiftGuards";

const shift = {
  id: "shift-1",
  cashierId: "cashier-1",
  openedAt: new Date("2026-07-12T09:00:00.000Z"),
  closedAt: new Date("2026-07-12T17:00:00.000Z"),
};

describe("cashier shift submission guard", () => {
  it("trusts an open submitted shift for the matching cashier", () => {
    expect(
      shouldTrustSubmittedCashierShift(
        { cashierId: "cashier-1", cashierShiftId: "shift-1" },
        { ...shift, status: "open", closedAt: null },
      ),
    ).toBe(true);
  });

  it("does not trust a closed shift on a normal online request", () => {
    expect(
      shouldTrustSubmittedCashierShift(
        { cashierId: "cashier-1", cashierShiftId: "shift-1" },
        { ...shift, status: "closed" },
      ),
    ).toBe(false);
  });

  it("trusts a closed shift only for offline replay queued during the shift", () => {
    expect(
      shouldTrustSubmittedCashierShift(
        {
          cashierId: "cashier-1",
          cashierShiftId: "shift-1",
          _offlineOrderReplay: true,
          _offlineQueuedAt: "2026-07-12T12:00:00.000Z",
        },
        { ...shift, status: "closed" },
      ),
    ).toBe(true);
  });

  it("rejects offline replay timestamps outside the shift window", () => {
    expect(
      shouldTrustSubmittedCashierShift(
        {
          cashierId: "cashier-1",
          cashierShiftId: "shift-1",
          _offlineOrderReplay: true,
          _offlineQueuedAt: "2026-07-12T18:00:00.000Z",
        },
        { ...shift, status: "closed" },
      ),
    ).toBe(false);
  });

  it("rejects mismatched cashier IDs", () => {
    expect(
      shouldTrustSubmittedCashierShift(
        {
          cashierId: "cashier-2",
          cashierShiftId: "shift-1",
          _offlineOrderReplay: true,
          _offlineQueuedAt: "2026-07-12T12:00:00.000Z",
        },
        { ...shift, status: "closed" },
      ),
    ).toBe(false);
  });
});
