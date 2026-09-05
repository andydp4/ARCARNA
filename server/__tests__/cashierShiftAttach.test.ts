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

/** The shift `resolveShiftForToday` finds or opens; swapped per test. */
let lazyShift: { id: string; cashierId: string | null } | null = null;

vi.mock("../services/tradingDayShift", () => ({
  resolveShiftForToday: async () => lazyShift,
}));

const { requireActiveCashierShift, attachActiveCashierShift } = await import(
  "../middleware/requireActiveCashierShift"
);

function run(middleware: typeof requireActiveCashierShift, user?: { id: string }) {
  const req: any = { orgContext: { orgId: ORG_ID }, headers: {}, body: {}, query: {}, user };
  let statusCode: number | null = null;
  let nexted = false;
  const res: any = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json: () => undefined,
  };
  return new Promise<{
    statusCode: number | null;
    nexted: boolean;
    req: any;
  }>((resolve) => {
    void (middleware as any)(req, res, () => {
      nexted = true;
      resolve({ statusCode, nexted, req });
    });
    setImmediate(() => resolve({ statusCode, nexted, req }));
  });
}

beforeEach(() => {
  orgRow = { cashierCommissionEnabled: true, requireCashierForSale: true };
  lazyShift = null;
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

/**
 * A shift opened on first sale carries no cashier code, and that is the normal
 * case now — the manual open that assigned one went away in L2.
 *
 * `cashierId` here feeds `orders.cashier_id`, `input_cashier_id` and
 * `completed_cashier_id`, all of them `uuid REFERENCES cashier_profiles`. The
 * field used to be typed `string`, so the resolver substituted the logged-in
 * user's id when the shift had no code — and a Clerk subject
 * (`user_3EFIamv0...`) is not a uuid. Every sale 500'd on
 * `invalid input syntax for type uuid` the moment the new model went live.
 *
 * Nothing here should ever put a user id in this field.
 */
describe("a shift opened on first sale has no cashier code", () => {
  const USER = { id: "user_3EFIamv0l9IggwK7Ncy6oDEPfWk" };
  const SHIFT_ID = "00000000-0000-4000-8000-0000000000cc";
  const CASHIER_CODE_ID = "00000000-0000-4000-8000-00000000000a";

  it("attaches the shift with a null cashier code, not the user id", async () => {
    lazyShift = { id: SHIFT_ID, cashierId: null };

    const { nexted, req } = await run(requireActiveCashierShift, USER);

    expect(nexted).toBe(true);
    expect(req.cashierShift).toEqual({
      cashierId: null,
      cashierShiftId: SHIFT_ID,
    });
    // The specific regression: a Clerk subject reaching a uuid column.
    expect(req.cashierShift.cashierId).not.toBe(USER.id);
  });

  it("still honours a real cashier code when the shift carries one", async () => {
    lazyShift = { id: SHIFT_ID, cashierId: CASHIER_CODE_ID };

    const { req } = await run(attachActiveCashierShift, USER);

    expect(req.cashierShift).toEqual({
      cashierId: CASHIER_CODE_ID,
      cashierShiftId: SHIFT_ID,
    });
  });

  it("takes the sale rather than refusing it, even though there is no code", async () => {
    // requireCashierForSale is on. The shift exists, so there is nothing to
    // refuse — the policy is about having a shift, not about having a code.
    lazyShift = { id: SHIFT_ID, cashierId: null };

    const { statusCode, nexted } = await run(requireActiveCashierShift, USER);

    expect(statusCode).toBeNull();
    expect(nexted).toBe(true);
  });
});
