/**
 * Commission splits 90/10 between the cashier who loaded an order and the one
 * who completed it, so the orders table now records both (migration 051).
 *
 * Two things have to hold for that split to be payable, and both are covered
 * here:
 *
 *   1. The completing cashier is frozen at the FIRST settlement, exactly like
 *      `settled_total`. If reopening an order and re-completing it under a
 *      different cashier moved this column, it would move 90% of a commission
 *      pool that had already accrued to somebody else.
 *   2. Recording that attribution must never block the completion itself. A
 *      manager clearing an order from the back office has no till and no
 *      cashier shift; refusing the status change to record an attribution that
 *      does not exist would break order management outright.
 */
import type { RequestHandler } from "express";
import { describe, expect, it, vi, beforeEach } from "vitest";

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const ORDER_ID = "00000000-0000-4000-8000-0000000000aa";
const CASHIER_A = "00000000-0000-4000-8000-00000000000a";
const CASHIER_B = "00000000-0000-4000-8000-00000000000b";
const SHIFT_B = "00000000-0000-4000-8000-0000000000bb";

/** The row the route reads before it writes; swapped per test. */
let currentOrder: Record<string, unknown>;
/** What the route actually wrote. */
let updatePatch: Record<string, unknown> | null;

const publishEventMock = vi.hoisted(() => vi.fn().mockResolvedValue("evt-1"));

vi.mock("../auth", () => {
  const pass = ((_req, _res, next) => next()) as RequestHandler;
  return {
    isAuthenticated: pass,
    isOwner: pass,
    requireOrgContext: pass,
    requireOrgScope: pass,
    requireSuperAdminMfa: pass,
    requireRole: () => pass,
  };
});

vi.mock("../eventBus", () => ({
  publishEvent: publishEventMock,
  publishEventTx: publishEventMock,
}));

vi.mock("../../apps/server/src/db", () => {
  const db = {
    select: () => ({ from: () => ({ where: async () => [currentOrder] }) }),
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        updatePatch = patch;
        return {
          where: () => ({
            returning: async () => [{ ...currentOrder, ...patch }],
          }),
        };
      },
    }),
  };
  return {
    db,
    withTransaction: async (fn: (tx: typeof db) => unknown) => fn(db),
  };
});

// The route pulls in middleware and services that open a real pool at import
// time. This suite is about the settlement patch, not the database, and must
// run in the no-DATABASE_URL CI job.
vi.mock("../db", () => ({ db: {}, pool: {} }));
vi.mock("../middleware/requireOpenShift", () => ({
  requireOpenShift: ((_req: any, _res: any, next: any) => next()) as RequestHandler,
}));
vi.mock("../middleware/requireActiveCashierShift", () => ({
  requireActiveCashierShift: ((_req: any, _res: any, next: any) => next()) as RequestHandler,
  attachActiveCashierShift: ((_req: any, _res: any, next: any) => next()) as RequestHandler,
}));
vi.mock("../services/cashierShiftEngine", () => ({
  refreshClosedCashierShiftSummary: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/creditLedger", () => ({
  openCreditForOrder: vi.fn().mockResolvedValue(undefined),
  // Nothing on tick in these fixtures, so no credit is opened.
  creditLegTotal: vi.fn().mockResolvedValue(0),
}));

vi.mock("../storage", () => ({ storage: {} }));
vi.mock("../adminAudit", () => ({ recordAdminAudit: vi.fn().mockResolvedValue(undefined) }));

const { registerOrderRoutes } = await import("../routes/orders");

type Handler = (req: any, res: any) => Promise<void> | void;

/** Mounts the routes and returns the PATCH /api/orders/:id handler chain. */
function patchHandler(): { middleware: RequestHandler[]; handler: Handler } {
  const chain: any[] = [];
  const app: any = {
    get: () => {},
    post: () => {},
    put: () => {},
    delete: () => {},
    patch: (path: string, ...rest: any[]) => {
      if (path === "/api/orders/:id") chain.push(...rest);
    },
  };
  registerOrderRoutes(app, []);
  return { middleware: chain.slice(0, -1), handler: chain[chain.length - 1] };
}

async function completeOrder(cashierShift?: {
  cashierId: string | null;
  cashierShiftId: string;
}) {
  const { handler } = patchHandler();
  const req: any = {
    params: { id: ORDER_ID },
    body: { status: "completed" },
    orgContext: { orgId: ORG_ID, locationId: null, role: "CASHIER" },
    cashierShift,
  };
  let status = 200;
  const res: any = {
    status(code: number) {
      status = code;
      return this;
    },
    json: (payload: unknown) => payload,
  };
  await handler(req, res);
  return { status };
}

beforeEach(() => {
  updatePatch = null;
  publishEventMock.mockClear();
});

describe("order attribution — the completing cashier", () => {
  it("records the completing cashier and shift at first settlement", async () => {
    currentOrder = { id: ORDER_ID, status: "pending", total: "120.00", settled_total: null, cashier_id: CASHIER_A };

    const { status } = await completeOrder({ cashierId: CASHIER_B, cashierShiftId: SHIFT_B });

    expect(status).toBe(200);
    expect(updatePatch).toMatchObject({
      completed_cashier_id: CASHIER_B,
      completed_cashier_shift_id: SHIFT_B,
      settled_total: "120.00",
    });
  });

  it("leaves the loading cashier's own attribution alone", async () => {
    // B completed what A loaded. `cashier_id` already names A and must stay
    // put — the 10% inputter share is read from it downstream.
    currentOrder = { id: ORDER_ID, status: "pending", total: "120.00", settled_total: null, cashier_id: CASHIER_A };

    await completeOrder({ cashierId: CASHIER_B, cashierShiftId: SHIFT_B });

    expect(updatePatch?.cashier_id).toBe(CASHIER_A);
  });

  it("does not move the completing cashier when an already-settled order is re-completed", async () => {
    // The attack this mirrors: reopen a settled order, re-complete it under a
    // different cashier, and walk off with 90% of a pool someone else earned.
    currentOrder = {
      id: ORDER_ID,
      status: "pending",
      total: "500.00",
      settled_total: "120.00",
      cashier_id: CASHIER_A,
      completed_cashier_id: CASHIER_A,
    };

    await completeOrder({ cashierId: CASHIER_B, cashierShiftId: SHIFT_B });

    expect(updatePatch).not.toHaveProperty("completed_cashier_id");
    expect(updatePatch).not.toHaveProperty("settled_total");
    expect(updatePatch).toMatchObject({ status: "completed" });
  });

  it("completes the order anyway when nobody is on a till", async () => {
    // A manager clearing an order from the back office. No cashier shift, so no
    // attribution to record — but the status change must still go through.
    currentOrder = { id: ORDER_ID, status: "pending", total: "120.00", settled_total: null, cashier_id: null };

    const { status } = await completeOrder(undefined);

    expect(status).toBe(200);
    expect(updatePatch).toMatchObject({ status: "completed", settled_total: "120.00" });
    expect(updatePatch).not.toHaveProperty("completed_cashier_id");
  });
});

/**
 * The columns holding a cashier CODE — `cashier_id`, `input_cashier_id`,
 * `completed_cashier_id` — are `uuid REFERENCES cashier_profiles`. A shift
 * opened on first sale has no code, so they must simply go unwritten.
 *
 * They were written unconditionally from a field the resolver had filled with
 * the logged-in user's id, which is a Clerk subject rather than a uuid. Postgres
 * rejected the UPDATE and every completion 500'd.
 */
describe("a completing shift with no cashier code", () => {
  const USER_ID = "user_3EFIamv0l9IggwK7Ncy6oDEPfWk";

  it("records the shift and the user, and writes no code columns", async () => {
    currentOrder = {
      id: ORDER_ID,
      status: "pending",
      total: "120.00",
      settled_total: null,
      cashier_id: null,
    };

    const { status } = await completeOrder({ cashierId: null, cashierShiftId: SHIFT_B });

    expect(status).toBe(200);
    expect(updatePatch).toMatchObject({
      completed_cashier_shift_id: SHIFT_B,
      settled_total: "120.00",
    });
    expect(updatePatch).not.toHaveProperty("completed_cashier_id");
    expect(updatePatch).not.toHaveProperty("cashier_id");
  });

  it("never lets a user id reach a cashier-code column", async () => {
    currentOrder = {
      id: ORDER_ID,
      status: "pending",
      total: "120.00",
      settled_total: null,
      cashier_id: null,
    };

    await completeOrder({ cashierId: null, cashierShiftId: SHIFT_B });

    for (const column of ["cashier_id", "input_cashier_id", "completed_cashier_id"]) {
      expect(updatePatch?.[column]).not.toBe(USER_ID);
    }
  });

  it("leaves an existing code alone rather than clearing it", async () => {
    // A order loaded under a cashier code, completed by somebody on a lazily
    // opened shift. The inputter's 10% is read from `cashier_id`; blanking it
    // would lose their share.
    currentOrder = {
      id: ORDER_ID,
      status: "pending",
      total: "120.00",
      settled_total: null,
      cashier_id: CASHIER_A,
    };

    await completeOrder({ cashierId: null, cashierShiftId: SHIFT_B });

    expect(updatePatch).not.toHaveProperty("cashier_id");
  });
});
