import { beforeEach, describe, expect, it, vi } from "vitest";
import { signCashierShiftReplayToken } from "../services/cashierShiftGuards";

const mocks = vi.hoisted(() => ({
  limit: vi.fn(),
  getOpenCashierShift: vi.fn(),
  touchCashierShiftActivity: vi.fn(),
}));

vi.mock("../db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: mocks.limit,
        })),
      })),
    })),
  },
}));

vi.mock("../services/cashierShiftEngine", () => ({
  getOpenCashierShift: mocks.getOpenCashierShift,
  touchCashierShiftActivity: mocks.touchCashierShiftActivity,
}));

describe("requireActiveCashierShift", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.limit.mockReset();
    mocks.getOpenCashierShift.mockReset();
    mocks.touchCashierShiftActivity.mockReset();
    process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
  });

  it("does not trust raw body cashier/shift ids without a signed replay token", async () => {
    const { requireActiveCashierShift } = await import("../middleware/requireActiveCashierShift");
    mocks.limit.mockResolvedValueOnce([{ cashierCommissionEnabled: true, requireCashierForSale: true }]);
    const req: any = {
      orgContext: { orgId: "org-1" },
      headers: {},
      body: {
        cashierId: "cashier-1",
        cashierShiftId: "closed-shift-1",
      },
      query: {},
    };
    const res = mockResponse();
    const next = vi.fn();

    await requireActiveCashierShift(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(mocks.getOpenCashierShift).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "CASHIER_SHIFT_REQUIRED" }),
    );
  });

  it("accepts a cashier/shift snapshot with a valid server replay token", async () => {
    const { requireActiveCashierShift } = await import("../middleware/requireActiveCashierShift");
    const openedAt = new Date("2026-07-07T10:00:00.000Z");
    const shift = {
      id: "33333333-3333-4333-8333-333333333333",
      orgId: "11111111-1111-4111-8111-111111111111",
      cashierId: "22222222-2222-4222-8222-222222222222",
      openedAt,
    };
    const token = signCashierShiftReplayToken({
      orgId: shift.orgId,
      cashierId: shift.cashierId,
      cashierShiftId: shift.id,
      openedAt,
    });
    mocks.limit
      .mockResolvedValueOnce([{ cashierCommissionEnabled: true, requireCashierForSale: true }])
      .mockResolvedValueOnce([shift]);
    const req: any = {
      orgContext: { orgId: shift.orgId },
      headers: {},
      body: {
        cashierId: shift.cashierId,
        cashierShiftId: shift.id,
        cashierShiftReplayToken: token,
      },
      query: {},
    };
    const res = mockResponse();
    const next = vi.fn();

    await requireActiveCashierShift(req, res as any, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.cashierShift).toEqual({
      cashierId: shift.cashierId,
      cashierShiftId: shift.id,
      replayedFromSignedSnapshot: true,
    });
  });
});

function mockResponse() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}
