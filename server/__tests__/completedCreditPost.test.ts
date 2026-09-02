/**
 * A caller can create an order already marked completed. If that order carries
 * a tick leg, it has already settled and must open the credit ledger in the
 * create path rather than waiting for a later PATCH status transition.
 */
import type { RequestHandler } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "00000000-0000-4000-8000-0000000000cc";
const ORDER_ID = "00000000-0000-4000-8000-0000000000aa";

const routeState = vi.hoisted(() => ({
  selectCalls: 0,
  createdOrder: {
    id: "00000000-0000-4000-8000-0000000000aa",
    org_id: "00000000-0000-4000-8000-000000000001",
    customer_id: "00000000-0000-4000-8000-0000000000cc",
    total: "120.00",
    payment_method: "tick",
    status: "completed",
    created_at: new Date("2026-09-02T10:00:00Z"),
  } as Record<string, unknown>,
  inserted: [] as unknown[],
}));

const engineMock = vi.hoisted(() => ({
  placeOrder: vi.fn().mockResolvedValue({ orderId: "00000000-0000-4000-8000-0000000000aa" }),
}));

const creditLedgerMock = vi.hoisted(() => ({
  openCreditForOrder: vi.fn().mockResolvedValue(undefined),
  creditLegTotal: vi.fn().mockResolvedValue(0),
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

vi.mock("../eventBus", () => ({
  publishEvent: vi.fn().mockResolvedValue("evt-1"),
  publishEventTx: vi.fn().mockResolvedValue("evt-1"),
}));

vi.mock("../../apps/server/src/db", () => ({
  withTransaction: async (fn: (tx: unknown) => unknown) =>
    fn({
      update: () => ({
        set: () => ({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => {
            routeState.selectCalls += 1;
            return routeState.selectCalls === 1 ? [routeState.createdOrder] : [];
          }),
        })),
      })),
      insert: () => ({
        values: vi.fn(async (rows: unknown) => {
          routeState.inserted.push(rows);
          return rows;
        }),
      }),
    }),
}));

vi.mock("../../apps/server/src/db/schema", async () => {
  const actual: any = await vi.importActual("../../apps/server/src/db/schema");
  return {
    orders: actual.orders,
    order_items: actual.order_items,
  };
});

vi.mock("../../apps/server/src/engine.wiring", () => ({
  engine: engineMock,
}));

vi.mock("../services/orgTaxRate", () => ({
  getOrgTaxRatePercent: vi.fn().mockResolvedValue(undefined),
}));

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

async function postOrder(body: Record<string, unknown>) {
  const handler = postHandler();
  const req: any = {
    body,
    orgContext: { orgId: ORG_ID, locationId: null, role: "CASHIER" },
    user: { id: "user_1" },
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
  return { status, payload };
}

beforeEach(() => {
  routeState.selectCalls = 0;
  routeState.inserted = [];
  routeState.createdOrder = {
    id: ORDER_ID,
    org_id: ORG_ID,
    customer_id: CUSTOMER_ID,
    total: "120.00",
    payment_method: "tick",
    status: "completed",
    created_at: new Date("2026-09-02T10:00:00Z"),
  };
  engineMock.placeOrder.mockClear();
  creditLedgerMock.openCreditForOrder.mockClear();
});

describe("completed credit orders created by POST", () => {
  it("opens credit for a completed tick order immediately", async () => {
    const { status } = await postOrder({
      lines: [{ productId: "p1", quantity: 1, unitPrice: 100 }],
      paymentMethod: "tick",
      customerId: CUSTOMER_ID,
      status: "completed",
    });

    expect(status).toBe(201);
    expect(creditLedgerMock.openCreditForOrder).toHaveBeenCalledWith(ORG_ID, {
      id: ORDER_ID,
      customerId: CUSTOMER_ID,
      amount: 120,
    });
  });

  it("opens only the tick leg for a completed split-credit order", async () => {
    routeState.createdOrder.payment_method = "split";

    const { status } = await postOrder({
      lines: [{ productId: "p1", quantity: 1, unitPrice: 100 }],
      paymentMethod: "split",
      customerId: CUSTOMER_ID,
      status: "completed",
      payments: [
        { method: "cash", amount: 70 },
        { method: "tick", amount: 50 },
      ],
    });

    expect(status).toBe(201);
    expect(creditLedgerMock.openCreditForOrder).toHaveBeenCalledWith(ORG_ID, {
      id: ORDER_ID,
      customerId: CUSTOMER_ID,
      amount: 50,
    });
  });
});
