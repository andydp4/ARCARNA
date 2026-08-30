/**
 * A sale on credit needs a customer to put the debt against.
 *
 * Nothing stopped one going through with none selected: `customerId` was
 * always optional on the order, and `openCreditForOrder` happily wrote
 * `customer_id: null` into `order_credit`. That debt was not merely
 * unattributed — `/api/tick-customers` filters out any row with no
 * `customerId` (see tickCustomers.ts), so it never appeared on the credit
 * list either. A cashier could put a real sale on tick for a walk-in and the
 * business would have no record anyone could act on: not on the list, not
 * chaseable, money gone.
 *
 * Guarded here, before the order is created, for the same reason personal use
 * is guarded before it's recorded: the cashier finds out at the till, not
 * after the sale has already gone through.
 */
import type { RequestHandler } from "express";
import { describe, expect, it, vi, beforeEach } from "vitest";

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "00000000-0000-4000-8000-0000000000cc";

const withTransactionMock = vi.hoisted(() =>
  vi.fn(async () => {
    throw new Error("stop-after-guard");
  }),
);
const appDbMock = vi.hoisted(() => {
  const selectWhere = vi.fn();
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from: selectFrom }));
  const updateReturning = vi.fn();
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  return {
    db: { select, update },
    selectWhere,
    updateReturning,
    updateSet,
    updateWhere,
  };
});
const publishEventMock = vi.hoisted(() => vi.fn().mockResolvedValue("evt-1"));
const publishEventTxMock = vi.hoisted(() => vi.fn().mockResolvedValue("evt-1"));
const creditLegTotalMock = vi.hoisted(() => vi.fn());
const openCreditForOrderMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

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
  publishEventTx: publishEventTxMock,
}));

vi.mock("../../apps/server/src/db", () => ({
  db: appDbMock.db,
  withTransaction: withTransactionMock,
}));

vi.mock("../../apps/server/src/db/schema", () => ({
  orders: {
    id: "orders.id",
    org_id: "orders.org_id",
  },
  order_items: {},
}));

vi.mock("../../apps/server/src/engine.wiring", () => ({
  engine: { placeOrder: vi.fn() },
}));

// getOrgTaxRatePercent reads `../db` for real; mocked directly rather than
// giving the mocked `db` below a full select().from().where().limit() chain
// it does not otherwise need.
vi.mock("../services/orgTaxRate", () => ({
  getOrgTaxRatePercent: vi.fn().mockResolvedValue(undefined),
}));

// The route's other static imports (giftCardService, loyaltyRedemptionService,
// bulkActionHandler, userDisplayName, cashierShiftEngine) all import `db` from
// here. Mocking it lets those modules load without opening a real connection;
// none of their functions are reached before the guard runs.
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
  creditLegTotal: creditLegTotalMock,
  openCreditForOrder: openCreditForOrderMock,
}));
vi.mock("../storage", () => ({ storage: {} }));
vi.mock("../adminAudit", () => ({ recordAdminAudit: vi.fn().mockResolvedValue(undefined) }));

const { registerOrderRoutes } = await import("../routes/orders");

type Handler = (req: any, res: any) => Promise<void> | void;

/** Mounts the routes and returns the POST /api/orders handler. */
function postHandler(): Handler {
  const chain: any[] = [];
  const app: any = {
    get: () => {},
    post: (path: string, ...rest: any[]) => {
      if (path === "/api/orders") chain.push(...rest);
    },
    put: () => {},
    patch: () => {},
    delete: () => {},
  };
  registerOrderRoutes(app, []);
  return chain[chain.length - 1];
}

/** Mounts the routes and returns the PATCH /api/orders/:id handler. */
function patchHandler(): Handler {
  const chain: any[] = [];
  const app: any = {
    get: () => {},
    post: () => {},
    put: () => {},
    patch: (path: string, ...rest: any[]) => {
      if (path === "/api/orders/:id") chain.push(...rest);
    },
    delete: () => {},
  };
  registerOrderRoutes(app, []);
  return chain[chain.length - 1];
}

async function placeOrder(body: Record<string, unknown>) {
  const handler = postHandler();
  const req: any = {
    body,
    orgContext: { orgId: ORG_ID, locationId: null, role: "CASHIER" },
    user: { id: "user_1" },
    cashierShift: { cashierId: null, cashierShiftId: "shift-1" },
  };
  let status = 200;
  let payload: unknown;
  const res: any = {
    status(code: number) {
      status = code;
      return this;
    },
    json: (p: unknown) => {
      payload = p;
      return p;
    },
  };
  await handler(req, res);
  return { status, payload: payload as { message?: string; code?: string } };
}

async function updateOrderStatus(body: Record<string, unknown>) {
  const handler = patchHandler();
  const req: any = {
    params: { id: "order-1" },
    body,
    orgContext: { orgId: ORG_ID, locationId: null, role: "CASHIER" },
    user: { id: "user_1" },
    cashierShift: { cashierId: null, cashierShiftId: "shift-1" },
  };
  let status = 200;
  let payload: unknown;
  const res: any = {
    status(code: number) {
      status = code;
      return this;
    },
    json: (p: unknown) => {
      payload = p;
      return p;
    },
  };
  await handler(req, res);
  return { status, payload: payload as { message?: string; code?: string } };
}

beforeEach(() => {
  withTransactionMock.mockClear();
  appDbMock.selectWhere.mockReset();
  appDbMock.updateReturning.mockReset();
  appDbMock.updateSet.mockClear();
  appDbMock.updateWhere.mockClear();
  appDbMock.db.select.mockClear();
  appDbMock.db.update.mockClear();
  creditLegTotalMock.mockReset();
  openCreditForOrderMock.mockClear();
  publishEventMock.mockClear();
  publishEventTxMock.mockClear();
});

describe("a sale on credit needs a customer", () => {
  it("refuses a plain tick sale with no customer", async () => {
    const { status, payload } = await placeOrder({
      lines: [{ productId: "p1", quantity: 1, unitPrice: 20 }],
      paymentMethod: "tick",
    });

    expect(status).toBe(400);
    expect(payload.code).toBe("CREDIT_CUSTOMER_REQUIRED");
    expect(withTransactionMock).not.toHaveBeenCalled();
  });

  it("refuses a split sale with a tick leg and no customer", async () => {
    // £50 cash, £20 on tick — the tick leg alone is enough to require a
    // customer, even though `paymentMethod` itself reads "split".
    const { status, payload } = await placeOrder({
      lines: [{ productId: "p1", quantity: 1, unitPrice: 70 }],
      paymentMethod: "split",
      payments: [
        { method: "cash", amount: 50 },
        { method: "tick", amount: 20 },
      ],
    });

    expect(status).toBe(400);
    expect(payload.code).toBe("CREDIT_CUSTOMER_REQUIRED");
    expect(withTransactionMock).not.toHaveBeenCalled();
  });

  it("lets a tick sale through once a customer is attached", async () => {
    const { payload } = await placeOrder({
      lines: [{ productId: "p1", quantity: 1, unitPrice: 20 }],
      paymentMethod: "tick",
      customerId: CUSTOMER_ID,
    });

    // withTransaction is mocked to throw once entered, so the guard clearly
    // did not fire — its rejection returns before withTransaction runs at all.
    expect(withTransactionMock).toHaveBeenCalledTimes(1);
    expect(payload.code).not.toBe("CREDIT_CUSTOMER_REQUIRED");
  });

  it("never blocks an ordinary cash sale for want of a customer", async () => {
    const { payload } = await placeOrder({
      lines: [{ productId: "p1", quantity: 1, unitPrice: 20 }],
      paymentMethod: "cash",
    });

    expect(withTransactionMock).toHaveBeenCalledTimes(1);
    expect(payload.code).not.toBe("CREDIT_CUSTOMER_REQUIRED");
  });

  it("refuses to complete an existing customerless credit order before changing its status", async () => {
    appDbMock.selectWhere.mockResolvedValueOnce([
      {
        id: "order-1",
        status: "pending",
        settled_total: null,
        payment_method: "tick",
        total: "70.00",
        customer_id: null,
      },
    ]);
    creditLegTotalMock.mockResolvedValueOnce(70);

    const { status, payload } = await updateOrderStatus({ status: "completed" });

    expect(status).toBe(400);
    expect(payload.code).toBe("CREDIT_CUSTOMER_REQUIRED");
    expect(appDbMock.db.update).not.toHaveBeenCalled();
    expect(openCreditForOrderMock).not.toHaveBeenCalled();
    expect(publishEventMock).not.toHaveBeenCalled();
  });

  it("still opens credit when a customer is attached before completion", async () => {
    appDbMock.selectWhere.mockResolvedValueOnce([
      {
        id: "order-1",
        status: "pending",
        settled_total: null,
        payment_method: "tick",
        total: "70.00",
        customer_id: CUSTOMER_ID,
        cashier_id: null,
      },
    ]);
    appDbMock.updateReturning.mockResolvedValueOnce([{ id: "order-1", status: "completed" }]);
    creditLegTotalMock.mockResolvedValueOnce(70);

    const { status, payload } = await updateOrderStatus({ status: "completed" });

    expect(status).toBe(200);
    expect(payload.code).not.toBe("CREDIT_CUSTOMER_REQUIRED");
    expect(openCreditForOrderMock).toHaveBeenCalledWith(ORG_ID, {
      id: "order-1",
      customerId: CUSTOMER_ID,
      amount: 70,
    });
    expect(publishEventMock).toHaveBeenCalledTimes(1);
  });
});
