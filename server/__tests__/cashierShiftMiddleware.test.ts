import { beforeEach, describe, expect, it, vi } from "vitest";
import { signCashierShiftReplayToken } from "../services/cashierShiftGuards";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  getOpenCashierShift: vi.fn(),
  touchCashierShiftActivity: vi.fn(),
}));

vi.mock("../db", () => ({
  db: {
    select: mocks.select,
  },
}));

vi.mock("../services/cashierShiftEngine", () => ({
  getOpenCashierShift: mocks.getOpenCashierShift,
  touchCashierShiftActivity: mocks.touchCashierShiftActivity,
}));

import { requireActiveCashierShift } from "../middleware/requireActiveCashierShift";

function queueSelects(...rows: unknown[][]) {
  mocks.select.mockImplementation(() => {
    const result = rows.shift() ?? [];
    return {
      from: () => ({
        where: () => ({
          limit: async () => result,
        }),
      }),
    };
  });
}

function response() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status: vi.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: vi.fn((body: unknown) => {
      res.body = body;
      return res;
    }),
  };
  return res;
}

const org = { cashierCommissionEnabled: true, requireCashierForSale: true };
const shift = {
  id: "33333333-3333-3333-3333-333333333333",
  cashierId: "22222222-2222-2222-2222-222222222222",
  status: "closed",
  openedAt: new Date("2026-07-04T10:00:00.000Z"),
  openedByUserId: "cashier-a",
};

describe("requireActiveCashierShift", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CASHIER_SHIFT_REPLAY_SECRET;
  });

  it("rejects client-supplied closed shift attribution without a replay token", async () => {
    queueSelects([org], [shift]);
    mocks.getOpenCashierShift.mockResolvedValue(null);
    const res = response();
    const next = vi.fn();

    await requireActiveCashierShift(
      {
        orgContext: { orgId: "11111111-1111-1111-1111-111111111111", role: "CASHIER" },
        user: { id: "cashier-a" },
        body: { cashierId: shift.cashierId, cashierShiftId: shift.id },
        headers: {},
        query: {},
      } as never,
      res as never,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.body).toMatchObject({ code: "CASHIER_SHIFT_REQUIRED" });
  });

  it("accepts closed shift attribution with a valid offline replay token", async () => {
    const orgId = "11111111-1111-1111-1111-111111111111";
    const token = signCashierShiftReplayToken(
      { orgId, cashierId: shift.cashierId, shiftId: shift.id, openedAt: shift.openedAt.toISOString() },
      "middleware-test-secret",
    );
    process.env.CASHIER_SHIFT_REPLAY_SECRET = "middleware-test-secret";
    queueSelects([org], [shift]);
    const res = response();
    const next = vi.fn();
    const req = {
      orgContext: { orgId, role: "CASHIER" },
      user: { id: "cashier-a" },
      body: { cashierId: shift.cashierId, cashierShiftId: shift.id, cashierShiftReplayToken: token },
      headers: {},
      query: {},
    } as { cashierShift?: unknown };

    await requireActiveCashierShift(req as never, res as never, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.cashierShift).toEqual({ cashierId: shift.cashierId, cashierShiftId: shift.id });
  });

  it("blocks live orders against another user's open cashier shift", async () => {
    queueSelects([org]);
    mocks.getOpenCashierShift.mockResolvedValue({ ...shift, status: "open" });
    const res = response();
    const next = vi.fn();

    await requireActiveCashierShift(
      {
        orgContext: { orgId: "11111111-1111-1111-1111-111111111111", role: "CASHIER" },
        user: { id: "cashier-b" },
        body: {},
        headers: { "x-cashier-id": shift.cashierId },
        query: {},
      } as never,
      res as never,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body).toMatchObject({ code: "CASHIER_SHIFT_FORBIDDEN" });
  });
});
