import type { RequestHandler } from "express";
import { describe, expect, it, vi, beforeEach } from "vitest";

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const ORDER_ID = "00000000-0000-4000-8000-0000000000aa";
const CUSTOMER_ID = "00000000-0000-4000-8000-0000000000cc";

let currentOrder: Record<string, unknown>;
let updatePatch: Record<string, unknown> | null;

const enginePlaceOrderMock = vi.hoisted(() => vi.fn().mockResolvedValue({ orderId: "new-order" }));
const creditLegTotalMock = vi.hoisted(() => vi.fn().mockResolvedValue(50));
const openCreditForOrderMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    and: vi.fn(() => ({ kind: "and" })),
    eq: vi.fn(() => ({ kind: "eq" })),
  };
});

vi.mock("../middleware/apiKeyAuth", () => {
  const pass = ((_req, _res, next) => next()) as RequestHandler;
  return { requireApiKey: pass, requireScope: () => pass };
});

vi.mock("../storage", () => ({ storage: {} }));

const ordersTable = vi.hoisted(() => ({
  id: "orders.id",
  org_id: "orders.org_id",
}));

vi.mock("../../apps/server/src/db/schema", () => ({
  orders: ordersTable,
  order_items: {},
  products: {},
  customers: {},
}));

vi.mock("../db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [currentOrder],
        }),
      }),
    }),
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
  },
  pool: {},
}));

vi.mock("../../apps/server/src/engine.wiring", () => ({
  engine: { placeOrder: enginePlaceOrderMock },
}));

vi.mock("../services/creditLedger", () => ({
  creditLegTotal: creditLegTotalMock,
  openCreditForOrder: openCreditForOrderMock,
}));

const { registerV1Routes } = await import("../routes/v1");

function route(method: "post" | "patch", path: string) {
  const routes: Record<string, any[]> = {};
  const app: any = {
    get: () => {},
    post: (p: string, ...rest: any[]) => {
      routes[`POST ${p}`] = rest;
    },
    patch: (p: string, ...rest: any[]) => {
      routes[`PATCH ${p}`] = rest;
    },
    put: () => {},
  };
  registerV1Routes(app);
  const chain = routes[`${method.toUpperCase()} ${path}`];
  return chain[chain.length - 1] as (req: any, res: any) => Promise<void>;
}

async function call(handler: (req: any, res: any) => Promise<void>, req: any) {
  let status = 200;
  let payload: any;
  const res: any = {
    status(code: number) {
      status = code;
      return this;
    },
    json(p: unknown) {
      payload = p;
      return p;
    },
  };
  await handler(req, res);
  return { status, payload };
}

beforeEach(() => {
  currentOrder = {
    id: ORDER_ID,
    org_id: ORG_ID,
    total: "50.00",
    payment_method: "tick",
    customer_id: CUSTOMER_ID,
    settled_total: null,
  };
  updatePatch = null;
  enginePlaceOrderMock.mockClear();
  creditLegTotalMock.mockReset();
  creditLegTotalMock.mockResolvedValue(50);
  openCreditForOrderMock.mockClear();
});

describe("v1 credit orders", () => {
  it("refuses to create a tick order without a customer", async () => {
    const result = await call(route("post", "/v1/orgs/:orgId/orders"), {
      params: { orgId: ORG_ID },
      apiKeyContext: { orgId: ORG_ID, scopes: ["orders:write"] },
      body: { paymentMethod: "tick", lines: [] },
    });

    expect(result.status).toBe(400);
    expect(result.payload.code).toBe("CREDIT_CUSTOMER_REQUIRED");
    expect(enginePlaceOrderMock).not.toHaveBeenCalled();
  });

  it("opens credit when a completed tick order is created", async () => {
    await call(route("post", "/v1/orgs/:orgId/orders"), {
      params: { orgId: ORG_ID },
      apiKeyContext: { orgId: ORG_ID, scopes: ["orders:write"] },
      body: {
        customerId: CUSTOMER_ID,
        paymentMethod: "tick",
        status: "completed",
        lines: [{ productId: "p1", quantity: 1, unitPrice: 50 }],
      },
    });

    expect(openCreditForOrderMock).toHaveBeenCalledWith(ORG_ID, {
      id: "new-order",
      customerId: CUSTOMER_ID,
      amount: 50,
    });
  });

  it("refuses to complete a customerless v1 tick order before writing status", async () => {
    currentOrder = { ...currentOrder, customer_id: null };

    const result = await call(route("patch", "/v1/orgs/:orgId/orders/:orderId"), {
      params: { orgId: ORG_ID, orderId: ORDER_ID },
      apiKeyContext: { orgId: ORG_ID, scopes: ["orders:write"] },
      body: { status: "completed" },
    });

    expect(result.status).toBe(400);
    expect(result.payload.code).toBe("CREDIT_CUSTOMER_REQUIRED");
    expect(updatePatch).toBeNull();
    expect(openCreditForOrderMock).not.toHaveBeenCalled();
  });

  it("opens credit when a customer-backed v1 tick order first completes", async () => {
    const result = await call(route("patch", "/v1/orgs/:orgId/orders/:orderId"), {
      params: { orgId: ORG_ID, orderId: ORDER_ID },
      apiKeyContext: { orgId: ORG_ID, scopes: ["orders:write"] },
      body: { status: "completed" },
    });

    expect(result.status).toBe(200);
    expect(updatePatch).toMatchObject({ status: "completed", settled_total: "50.00" });
    expect(openCreditForOrderMock).toHaveBeenCalledWith(ORG_ID, {
      id: ORDER_ID,
      customerId: CUSTOMER_ID,
      amount: 50,
    });
  });
});
