import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { canAttachSubmittedCashierShift } from "../services/cashierShiftGuards";

const mocks = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  getOpenCashierShift: vi.fn(),
  touchCashierShiftActivity: vi.fn(),
}));

vi.mock("../db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => mocks.selectResults.shift() ?? []),
        })),
      })),
    })),
  },
}));

vi.mock("../services/cashierShiftEngine", () => ({
  getOpenCashierShift: mocks.getOpenCashierShift,
  touchCashierShiftActivity: mocks.touchCashierShiftActivity,
}));

function makeResponse() {
  const res = {
    status: vi.fn(function status(this: { statusCode?: number }, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(function json(this: { body?: unknown }, body: unknown) {
      this.body = body;
      return this;
    }),
  };
  return res as unknown as Response & { body?: unknown; statusCode?: number };
}

describe("canAttachSubmittedCashierShift", () => {
  it("rejects matching submitted cashier context once the shift is closed", () => {
    expect(
      canAttachSubmittedCashierShift(
        { id: "shift-1", cashierId: "cashier-1", status: "closed" },
        "cashier-1",
      ),
    ).toBe(false);
  });

  it("accepts matching submitted cashier context only for an open shift", () => {
    expect(
      canAttachSubmittedCashierShift(
        { id: "shift-1", cashierId: "cashier-1", status: "open" },
        "cashier-1",
      ),
    ).toBe(true);
  });
});

describe("requireActiveCashierShift", () => {
  beforeEach(() => {
    mocks.selectResults.length = 0;
    mocks.getOpenCashierShift.mockReset();
    mocks.touchCashierShiftActivity.mockReset();
  });

  it("does not let a body-supplied closed shift satisfy required cashier shift policy", async () => {
    const { requireActiveCashierShift } = await import("../middleware/requireActiveCashierShift");
    const req = {
      orgContext: { orgId: "org-1" },
      body: { cashierId: "cashier-1", cashierShiftId: "closed-shift-1" },
      headers: {},
      query: {},
    } as unknown as Request;
    const res = makeResponse();
    const next = vi.fn() as NextFunction;

    mocks.selectResults.push(
      [{ cashierCommissionEnabled: true, requireCashierForSale: true }],
      [{ id: "closed-shift-1", cashierId: "cashier-1", status: "closed" }],
    );
    mocks.getOpenCashierShift.mockResolvedValue(null);

    await requireActiveCashierShift(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.body).toEqual({
      message: "No active shift for this cashier. Start a cashier shift before taking sales.",
      code: "CASHIER_SHIFT_REQUIRED",
    });
    expect((req as Request & { cashierShift?: unknown }).cashierShift).toBeUndefined();
  });

  it("continues to attach the real open shift for the selected cashier", async () => {
    const { requireActiveCashierShift } = await import("../middleware/requireActiveCashierShift");
    const req = {
      orgContext: { orgId: "org-1" },
      body: {},
      headers: { "x-cashier-id": "cashier-1" },
      query: {},
    } as unknown as Request;
    const res = makeResponse();
    const next = vi.fn() as NextFunction;

    mocks.selectResults.push([{ cashierCommissionEnabled: true, requireCashierForSale: true }]);
    mocks.getOpenCashierShift.mockResolvedValue({ id: "open-shift-1" });

    await requireActiveCashierShift(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(mocks.touchCashierShiftActivity).toHaveBeenCalledWith("open-shift-1");
    expect((req as Request & { cashierShift?: unknown }).cashierShift).toEqual({
      cashierId: "cashier-1",
      cashierShiftId: "open-shift-1",
    });
  });
});
