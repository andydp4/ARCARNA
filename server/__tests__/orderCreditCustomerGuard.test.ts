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

const appDbMock = vi.hoisted(() => {
  const state: {
    currentOrder: Record<string, unknown> | null;
    updatePatch: Record<string, unknown> | null;
    /** Table object (identity) → seeded rows. `orders` and `orderEvents` both
     * flow through here so `completeOrderTx`'s extra `order_events` lookup
     * (checking for a prior `completed` event, to decide first-settle vs
     * resettle) gets an answer distinct from the locked order row. */
    rowsByTable: Map<unknown, unknown[]>;
  } = {
    currentOrder: null,
    updatePatch: null,
    rowsByTable: new Map(),
  };
  const selectChain = (table: unknown) => {
    // The locked-row read (`PATCH`'s own `SELECT … FOR UPDATE`) has no table
    // registered yet on the first call of a test — fall back to `currentOrder`
    // for that one case; every other table (order_events, ...) is looked up
    // by identity.
    const rows = state.rowsByTable.get(table) ?? (state.currentOrder ? [state.currentOrder] : []);
    const chain: any = {
      where: () => chain,
      orderBy: () => chain,
      for: () => chain,
      limit: () => Promise.resolve(rows),
    };
    return chain;
  };
  const select = vi.fn(() => ({ from: selectChain }));
  const update = vi.fn(() => ({
    set: vi.fn((patch: Record<string, unknown>) => {
      state.updatePatch = patch;
      return {
        where: vi.fn(() => ({
          returning: vi.fn(async () =>
            state.currentOrder ? [{ ...state.currentOrder, ...patch }] : [],
          ),
        })),
      };
    }),
  }));
  const insert = vi.fn(() => ({
    values: (values: Record<string, unknown>) => {
      const promise = Promise.resolve(undefined) as Promise<undefined> & { returning?: () => Promise<unknown[]> };
      promise.returning = () => Promise.resolve([{ id: "evt-1", ...values }]);
      return promise;
    },
  }));
  return {
    state,
    db: { select, update, insert },
    withTransaction: vi.fn(async () => {
      throw new Error("stop-after-guard");
    }),
  };
});

const creditLedgerMock = vi.hoisted(() => {
  class CreditError extends Error {
    status: number;
    code: string;
    constructor(message: string, status = 400, code = "CREDIT_ERROR") {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  return {
    creditLegTotal: vi.fn(),
    // Mirrors the real function's own guard (server/services/creditLedger.ts):
    // this is genuinely what raises `CREDIT_CUSTOMER_REQUIRED` now that the
    // route no longer duplicates the check inline (Phase N, N3b —
    // `completeOrderTx` calls the real `openCreditForOrder` for that reason).
    openCreditForOrder: vi.fn(async (_orgId: string, order: { customerId: string | null; amount: number }) => {
      if (order.amount > 0 && !order.customerId) {
        throw new CreditError(
          "Select a customer before putting a sale on credit.",
          400,
          "CREDIT_CUSTOMER_REQUIRED",
        );
      }
    }),
    voidCredit: vi.fn(),
    CreditError,
  };
});

const eventBusMock = vi.hoisted(() => ({
  publishEvent: vi.fn(),
  publishEventTx: vi.fn(),
}));

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

vi.mock("../eventBus", () => eventBusMock);

vi.mock("../../apps/server/src/db", () => ({
  withTransaction: appDbMock.withTransaction,
  db: appDbMock.db,
}));

vi.mock("../../apps/server/src/db/schema", async () => {
  const actual: any = await vi.importActual("../../apps/server/src/db/schema");
  return {
    orders: actual.orders,
    order_items: actual.order_items,
  };
});

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
vi.mock("../services/creditLedger", () => creditLedgerMock);
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

const defaultOpenCreditForOrder = creditLedgerMock.openCreditForOrder.getMockImplementation();

beforeEach(() => {
  appDbMock.withTransaction.mockReset();
  appDbMock.withTransaction.mockImplementation(async () => {
    throw new Error("stop-after-guard");
  });
  appDbMock.db.select.mockClear();
  appDbMock.db.update.mockClear();
  appDbMock.state.currentOrder = null;
  appDbMock.state.updatePatch = null;
  appDbMock.state.rowsByTable.clear();
  creditLedgerMock.creditLegTotal.mockReset();
  creditLedgerMock.openCreditForOrder.mockReset();
  creditLedgerMock.openCreditForOrder.mockImplementation(defaultOpenCreditForOrder);
  eventBusMock.publishEvent.mockReset();
  eventBusMock.publishEvent.mockResolvedValue("evt-1");
  eventBusMock.publishEventTx.mockReset();
  eventBusMock.publishEventTx.mockResolvedValue("evt-1");
});

describe("a sale on credit needs a customer", () => {
  it("refuses a plain tick sale with no customer", async () => {
    const { status, payload } = await placeOrder({
      lines: [{ productId: "p1", quantity: 1, unitPrice: 20 }],
      paymentMethod: "tick",
    });

    expect(status).toBe(400);
    expect(payload.code).toBe("CREDIT_CUSTOMER_REQUIRED");
    expect(appDbMock.withTransaction).not.toHaveBeenCalled();
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
    expect(appDbMock.withTransaction).not.toHaveBeenCalled();
  });

  it("lets a tick sale through once a customer is attached", async () => {
    const { payload } = await placeOrder({
      lines: [{ productId: "p1", quantity: 1, unitPrice: 20 }],
      paymentMethod: "tick",
      customerId: CUSTOMER_ID,
    });

    // withTransaction is mocked to throw once entered, so the guard clearly
    // did not fire — its rejection returns before withTransaction runs at all.
    expect(appDbMock.withTransaction).toHaveBeenCalledTimes(1);
    expect(payload.code).not.toBe("CREDIT_CUSTOMER_REQUIRED");
  });

  it("never blocks an ordinary cash sale for want of a customer", async () => {
    const { payload } = await placeOrder({
      lines: [{ productId: "p1", quantity: 1, unitPrice: 20 }],
      paymentMethod: "cash",
    });

    expect(appDbMock.withTransaction).toHaveBeenCalledTimes(1);
    expect(payload.code).not.toBe("CREDIT_CUSTOMER_REQUIRED");
  });

  it("refuses to complete an existing customerless credit order — the whole transaction throws", async () => {
    appDbMock.state.currentOrder = {
      id: "order-1",
      org_id: ORG_ID,
      customer_id: null,
      total: "70.00",
      payment_method: "tick",
      status: "pending",
      settled_total: null,
    };
    appDbMock.withTransaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(appDbMock.db),
    );
    const { orderEvents } = await import("@shared/schema");
    appDbMock.state.rowsByTable.set(orderEvents, []); // no prior `completed` event — first settle, not a resettle
    creditLedgerMock.creditLegTotal.mockResolvedValue(70);

    const handler = patchHandler();
    const req: any = {
      params: { id: "order-1" },
      body: { status: "completed" },
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

    expect(status).toBe(400);
    expect((payload as { code?: string }).code).toBe("CREDIT_CUSTOMER_REQUIRED");
    expect(creditLedgerMock.creditLegTotal).toHaveBeenCalledWith("order-1", "tick", 70, appDbMock.db);
    expect(creditLedgerMock.openCreditForOrder).toHaveBeenCalledTimes(1);
    // This mock does not simulate a real Postgres ROLLBACK (its `update` just
    // resolves), so it cannot itself prove the settlement patch above did not
    // stick — that is `orderTransitionAtomicity.test.ts`'s job, against a
    // real database. What this DOES prove: the credit guard runs from INSIDE
    // the same transaction as the settlement write, on the LOCKED row, not as
    // a separate pre-flight check the way the pre-N3b handler ran it.
  });

  it("opens credit in the same transaction as completing an existing order", async () => {
    appDbMock.state.currentOrder = {
      id: "order-1",
      org_id: ORG_ID,
      customer_id: CUSTOMER_ID,
      total: "70.00",
      payment_method: "tick",
      status: "pending",
      settled_total: null,
    };
    appDbMock.withTransaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(appDbMock.db),
    );
    const { orderEvents } = await import("@shared/schema");
    appDbMock.state.rowsByTable.set(orderEvents, []);
    creditLedgerMock.creditLegTotal.mockResolvedValue(70);

    const handler = patchHandler();
    const req: any = {
      params: { id: "order-1" },
      body: { status: "completed" },
      orgContext: { orgId: ORG_ID, locationId: null, role: "CASHIER" },
      user: { id: "user_1" },
      cashierShift: { cashierId: null, cashierShiftId: "shift-1" },
    };
    const res: any = {
      status() {
        return this;
      },
      json: (p: unknown) => p,
    };

    await handler(req, res);

    expect(appDbMock.withTransaction).toHaveBeenCalledTimes(1);
    expect(appDbMock.state.updatePatch).toMatchObject({
      status: "completed",
      settled_total: "70.00",
      completed_user_id: "user_1",
      completed_cashier_shift_id: "shift-1",
    });
    expect(creditLedgerMock.openCreditForOrder).toHaveBeenCalledWith(
      ORG_ID,
      { id: "order-1", customerId: CUSTOMER_ID, amount: 70 },
      appDbMock.db,
    );
    expect(eventBusMock.publishEventTx).toHaveBeenCalledWith(
      appDbMock.db,
      "OrderStatusChanged",
      "order-1",
      expect.objectContaining({ from: "pending", to: "completed" }),
      { source: "api-orders" },
    );
  });
});
