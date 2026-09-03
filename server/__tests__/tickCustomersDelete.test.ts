/**
 * Removing a customer from the credit list closes the credit ledger rows.
 *
 * The list is backed by `order_credit`, not by order status. Updating old tick
 * orders to completed is therefore a no-op: the customer still appears as
 * owing money after the success toast.
 */
import type { RequestHandler } from "express";
import { describe, expect, it, vi, beforeEach } from "vitest";

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "00000000-0000-4000-8000-0000000000cc";
const ORDER_A = "00000000-0000-4000-8000-0000000000aa";
const ORDER_B = "00000000-0000-4000-8000-0000000000bb";

let outstandingRows: Array<{ orderId: string; outstanding: string }>;

const writeOffCreditMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const managerGate = vi.hoisted(() => ((_req: any, _res: any, next: any) => next()) as RequestHandler);

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    and: vi.fn(() => ({ kind: "and" })),
    eq: vi.fn(() => ({ kind: "eq" })),
    inArray: vi.fn(() => ({ kind: "inArray" })),
  };
});

vi.mock("../auth", () => {
  const pass = ((_req, _res, next) => next()) as RequestHandler;
  return {
    isAuthenticated: pass,
    isOwner: pass,
    requireOrgContext: pass,
    requireOrgScope: pass,
    requireSuperAdminMfa: pass,
    requireRole: () => managerGate,
  };
});

vi.mock("../storage", () => ({
  storage: {
    getCustomer: vi.fn().mockResolvedValue({ id: CUSTOMER_ID, name: "A Customer" }),
  },
}));

vi.mock("../db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => outstandingRows,
      }),
    }),
  },
  pool: {},
}));

vi.mock("../services/creditLedger", () => ({
  writeOffCredit: writeOffCreditMock,
}));

vi.mock("@shared/schema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@shared/schema")>();
  return {
    ...actual,
    orderCredit: {
      orgId: "order_credit.org_id",
      customerId: "order_credit.customer_id",
      status: "order_credit.status",
      orderId: "order_credit.order_id",
      amountOutstanding: "order_credit.amount_outstanding",
    },
  };
});

vi.mock("../adminAudit", () => ({ recordAdminAudit: vi.fn().mockResolvedValue(undefined) }));

const { registerTickCustomerRoutes } = await import("../routes/tickCustomers");

function deleteRoute() {
  const routes: Record<string, any[]> = {};
  const app: any = {
    get: () => {},
    post: () => {},
    delete: (path: string, ...rest: any[]) => {
      routes[path] = rest;
    },
  };
  registerTickCustomerRoutes(app, []);
  return routes["/api/tick-customers/:id"];
}

async function removeCustomer() {
  const chain = deleteRoute();
  const handler = chain[chain.length - 1] as (req: any, res: any) => Promise<void>;
  const req: any = {
    params: { id: CUSTOMER_ID },
    orgContext: { orgId: ORG_ID, locationId: null, role: "MANAGER" },
    user: { id: "user_1" },
  };
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
  return { status, payload, chain };
}

beforeEach(() => {
  outstandingRows = [
    { orderId: ORDER_A, outstanding: "30.25" },
    { orderId: ORDER_B, outstanding: "12.25" },
  ];
  writeOffCreditMock.mockClear();
});

describe("credit customer removal", () => {
  it("is protected as a manager-level write-off action", () => {
    const chain = deleteRoute();
    expect(chain).toContain(managerGate);
  });

  it("writes off each outstanding credit row for that customer", async () => {
    const { status, payload } = await removeCustomer();

    expect(status).toBe(200);
    expect(writeOffCreditMock).toHaveBeenCalledTimes(2);
    expect(writeOffCreditMock).toHaveBeenNthCalledWith(1, ORG_ID, ORDER_A);
    expect(writeOffCreditMock).toHaveBeenNthCalledWith(2, ORG_ID, ORDER_B);
    expect(payload).toMatchObject({
      message: "Customer removed from the credit list",
      creditsWrittenOff: 2,
      amountWrittenOff: 42.5,
    });
  });
});
