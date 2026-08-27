/**
 * `requireActiveCashierShift` and `attachActiveCashierShift` are the same
 * resolver with one difference: what happens when there is no shift to attach.
 *
 * Taking a sale without a cashier is a policy question the org answers with
 * `requireCashierForSale`, so the sale path refuses. Completing an order is
 * not — a manager clearing an order from the back office has no till — so the
 * completion path records the attribution when it exists and steps aside when
 * it does not. Getting that backwards would either lose the 90% share on every
 * completion, or lock managers out of order management entirely.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const ORG_ID = "00000000-0000-4000-8000-000000000001";

let orgRow: { cashierCommissionEnabled: boolean; requireCashierForSale: boolean };

vi.mock("../db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [orgRow] }) }),
    }),
  },
}));

vi.mock("../services/cashierShiftEngine", () => ({
  getOpenCashierShift: async () => null,
  touchCashierShiftActivity: async () => undefined,
}));

vi.mock("../services/cashierShiftReplayToken", () => ({
  validateCashierShiftReplay: () => ({ ok: false, reason: "not-tested" }),
}));

const { requireActiveCashierShift, attachActiveCashierShift } = await import(
  "../middleware/requireActiveCashierShift"
);

function run(middleware: typeof requireActiveCashierShift) {
  const req: any = { orgContext: { orgId: ORG_ID }, headers: {}, body: {}, query: {} };
  let statusCode: number | null = null;
  let nexted = false;
  const res: any = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json: () => undefined,
  };
  return new Promise<{ statusCode: number | null; nexted: boolean }>((resolve) => {
    void (middleware as any)(req, res, () => {
      nexted = true;
      resolve({ statusCode, nexted });
    });
    setImmediate(() => resolve({ statusCode, nexted }));
  });
}

beforeEach(() => {
  orgRow = { cashierCommissionEnabled: true, requireCashierForSale: true };
});

describe("cashier shift middleware", () => {
  it("refuses a sale when the org demands a cashier and none is on", async () => {
    const { statusCode } = await run(requireActiveCashierShift);
    expect(statusCode).toBe(409);
  });

  it("lets a completion through in the same situation", async () => {
    const { statusCode, nexted } = await run(attachActiveCashierShift);
    expect(statusCode).toBeNull();
    expect(nexted).toBe(true);
  });

  it("lets a sale through when the org does not demand a cashier", async () => {
    orgRow = { cashierCommissionEnabled: true, requireCashierForSale: false };
    const { statusCode, nexted } = await run(requireActiveCashierShift);
    expect(statusCode).toBeNull();
    expect(nexted).toBe(true);
  });

  it("steps aside entirely when commission tracking is off", async () => {
    orgRow = { cashierCommissionEnabled: false, requireCashierForSale: true };
    for (const mw of [requireActiveCashierShift, attachActiveCashierShift]) {
      const { statusCode, nexted } = await run(mw);
      expect(statusCode).toBeNull();
      expect(nexted).toBe(true);
    }
  });
});
