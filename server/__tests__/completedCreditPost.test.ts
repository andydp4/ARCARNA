/**
 * A credit sale created already completed still needs an `order_credit` row.
 *
 * Most POS orders are created pending and later settle through PATCH
 * /api/orders/:id, but API/import-style callers can pass `status: "completed"`
 * directly into the shared order engine. Those orders never hit the settlement
 * route, so POST must open the ledger entry before it returns.
 */
import type { RequestHandler } from "express";
import { describe, expect, it, vi, beforeEach } from "vitest";

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const ORDER_ID = "00000000-0000-4000-8000-0000000000aa";
const CUSTOMER_ID = "00000000-0000-4000-8000-0000000000cc";

const enginePlaceOrderMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ orderId: "00000000-0000-4000-8000-0000000000aa" }),
);
const creditLegTotalMock = vi.hoisted(() => vi.fn().mockResolvedValue(42.5));
const openCreditForOrderMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const publishEventTxMock = vi.hoisted(() => vi.fn().mockResolvedValue("evt-1"));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, eq: vi.fn(() => ({ kind: "eq" })) };
});

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
  publishEvent: vi.fn().mockResolvedValue("evt-1"),
  publishEventTx: publishEventTxMock,
}));

const { ordersTable, orderItemsTable } = vi.hoisted(() => ({
  ordersTable: { id: "orders.id" },
  orderItemsTable: { order_id: "order_items.order_id" },
}));
vi.mock("../../apps/server/src/db/schema", () => ({
  orders: ordersTable,
  order_items: orderItemsTable,
}));

function makeTx() {
  const createdOrder = {
    id: ORDER_ID,
    status: "completed",
    total: "42.50",
    payment_method: "tick",
    customer_id: CUSTOMER_ID,
    created_at: new Date("2026-09-03T10:00:00.000Z"),
  };
  const items = [
    {
      id: "line-1",
      product_id: "00000000-0000-4000-8000-000000000111",
      quantity: 1,
      unit_price: "42.50",
      total_price: "42.50",
    },
  ];

  return {
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    select: () => ({
      from: (table: unknown) => ({
        where: async () => (table === ordersTable ? [createdOrder] : items),
      }),
    }),
    insert: () => ({ values: vi.fn().mockResolvedValue(undefined) }),
  };
}

vi.mock("../../apps/server/src/db", () => ({
  withTransaction: async (fn: (tx: unknown) => unknown) => fn(makeTx()),
}));

vi.mock("../../apps/server/src/engine.wiring", () => ({
  engine: { placeOrder: enginePlaceOrderMock },
}));

vi.mock("../services/orgTaxRate", () => ({
  getOrgTaxRatePercent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/creditLedger", () => ({
  creditLegTotal: creditLegTotalMock,
  openCreditForOrder: openCreditForOrderMock,
}));

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
vi.mock("../storage", () => ({ storage: {} }));
vi.mock("../adminAudit", () => ({ recordAdminAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../db", () => ({ db: {}, pool: {} }));

const { registerOrderRoutes } = await import("../routes/orders");

function postHandler() {
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
  return chain[chain.length - 1] as (req: any, res: any) => Promise<void>;
}

beforeEach(() => {
  enginePlaceOrderMock.mockClear();
  creditLegTotalMock.mockClear();
  openCreditForOrderMock.mockClear();
  publishEventTxMock.mockClear();
});

describe("completed credit order creation", () => {
  it("opens order_credit for a completed tick order created through POST", async () => {
    const req: any = {
      body: {
        customerId: CUSTOMER_ID,
        lines: [{ productId: "p1", quantity: 1, unitPrice: 42.5 }],
        paymentMethod: "tick",
        status: "completed",
      },
      orgContext: { orgId: ORG_ID, locationId: null, role: "CASHIER" },
      user: { id: "user_1" },
    };
    let status = 200;
    const res: any = {
      status(code: number) {
        status = code;
        return this;
      },
      json: vi.fn(),
    };

    await postHandler()(req, res);

    expect(status).toBe(201);
    expect(creditLegTotalMock).toHaveBeenCalledWith(ORDER_ID, "tick", 42.5);
    expect(openCreditForOrderMock).toHaveBeenCalledWith(ORG_ID, {
      id: ORDER_ID,
      customerId: CUSTOMER_ID,
      amount: 42.5,
    });
  });
});
