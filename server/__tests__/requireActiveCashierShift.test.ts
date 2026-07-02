import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCashierShiftReplayToken } from "../services/cashierShiftReplayToken";

const selectRows: unknown[][] = [];
const getOpenCashierShift = vi.fn();
const touchCashierShiftActivity = vi.fn();

function selectBuilder() {
  return {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(selectRows.shift() ?? []),
      }),
    }),
  };
}

vi.mock("../db", () => ({
  db: {
    select: vi.fn(selectBuilder),
  },
}));

vi.mock("../services/cashierShiftEngine", () => ({
  getOpenCashierShift,
  touchCashierShiftActivity,
}));

const { requireActiveCashierShift } = await import("../middleware/requireActiveCashierShift");

function makeResponse() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

function makeRequest(overrides: Partial<Request> = {}) {
  return {
    headers: {},
    body: {},
    query: {},
    orgContext: { orgId: "11111111-1111-1111-1111-111111111111" },
    ...overrides,
  } as Request & { orgContext: { orgId: string }; cashierShift?: { cashierId: string; cashierShiftId: string } };
}

describe("requireActiveCashierShift", () => {
  beforeEach(() => {
    selectRows.length = 0;
    getOpenCashierShift.mockReset();
    touchCashierShiftActivity.mockReset();
  });

  it("does not trust body cashier shift fields without a signed offline replay token", async () => {
    selectRows.push([{ cashierCommissionEnabled: true, requireCashierForSale: true }]);
    const req = makeRequest({
      body: {
        cashierId: "22222222-2222-2222-2222-222222222222",
        cashierShiftId: "33333333-3333-3333-3333-333333333333",
      },
    });
    const res = makeResponse();
    const next = vi.fn();

    await requireActiveCashierShift(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(getOpenCashierShift).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "CASHIER_SHIFT_REQUIRED" }));
  });

  it("accepts a signed offline replay for the original cashier shift", async () => {
    const shift = {
      id: "33333333-3333-3333-3333-333333333333",
      orgId: "11111111-1111-1111-1111-111111111111",
      cashierId: "22222222-2222-2222-2222-222222222222",
      openedAt: new Date("2026-07-02T10:00:00.000Z"),
    };
    const token = createCashierShiftReplayToken({
      orgId: shift.orgId,
      cashierId: shift.cashierId,
      shiftId: shift.id,
      openedAt: shift.openedAt.toISOString(),
    });
    selectRows.push([{ cashierCommissionEnabled: true, requireCashierForSale: true }], [shift]);
    const req = makeRequest({
      headers: { "x-offline-replay": "1" },
      body: {
        cashierId: shift.cashierId,
        cashierShiftId: shift.id,
        cashierShiftToken: token,
      },
    });
    const res = makeResponse();
    const next = vi.fn();

    await requireActiveCashierShift(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.cashierShift).toEqual({ cashierId: shift.cashierId, cashierShiftId: shift.id });
  });
});
