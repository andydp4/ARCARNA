import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { cashierCommissionEntries, creditPayments, customers, orderCredit, orders, organizations } from "@shared/schema";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("tick customer settlement routes", () => {
  let db: (typeof import("../db"))["db"];
  let app: express.Express;
  let orgId: string;
  let customerId: string;
  let orderId: string;
  let role: string;

  beforeEach(async () => {
    ({ db } = await import("../db"));
    const { registerTickCustomerRoutes } = await import("../routes/tickCustomers");

    orgId = randomUUID();
    customerId = randomUUID();
    orderId = randomUUID();
    role = "ADMIN";

    await db.insert(organizations).values({ id: orgId, name: "Tick Route Test" });
    await db.insert(customers).values({ id: customerId, orgId, name: "Credit Customer" });
    await db.insert(orders).values({
      id: orderId,
      orgId,
      customerId,
      total: "125.50",
      paymentMethod: "tick",
      status: "pending",
    } as never);

    const scoped: RequestHandler = (req: any, _res, next) => {
      req.orgContext = { orgId, locationId: null, role };
      req.user = { id: "test-admin", role };
      next();
    };

    app = express();
    app.use(express.json());
    registerTickCustomerRoutes(app, [scoped]);
  });

  afterEach(async () => {
    await db.delete(cashierCommissionEntries).where(eq(cashierCommissionEntries.orgId, orgId));
    await db.delete(creditPayments).where(eq(creditPayments.orgId, orgId));
    await db.delete(orderCredit).where(eq(orderCredit.orgId, orgId));
    await db.delete(orders).where(eq(orders.orgId, orgId));
    await db.delete(customers).where(eq(customers.orgId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("writes off outstanding credit when removing a customer from the credit list", async () => {
    await db.insert(orderCredit).values({
      orderId,
      orgId,
      customerId,
      amountGiven: "125.50",
      amountOutstanding: "125.50",
      status: "outstanding",
      givenOn: "2026-08-01",
    });

    const res = await request(app).delete(`/api/tick-customers/${customerId}`).expect(200);
    expect(res.body.creditsWrittenOff).toBe(1);

    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order.status).toBe("pending");
    expect(order.settledTotal).toBeNull();
    expect(order.settledAt).toBeNull();

    const [credit] = await db.select().from(orderCredit).where(eq(orderCredit.orderId, orderId));
    expect(credit.status).toBe("written_off");
    expect(parseFloat(String(credit.amountOutstanding))).toBe(0);

    const payments = await db.select().from(creditPayments).where(eq(creditPayments.orderId, orderId));
    expect(payments).toHaveLength(0);

    const list = await request(app).get("/api/tick-customers").expect(200);
    expect(list.body).toEqual([]);
  });

  it("does not let cashiers write off credit by removing a customer", async () => {
    await db.insert(orderCredit).values({
      orderId,
      orgId,
      customerId,
      amountGiven: "125.50",
      amountOutstanding: "125.50",
      status: "outstanding",
      givenOn: "2026-08-01",
    });
    role = "CASHIER";

    await request(app).delete(`/api/tick-customers/${customerId}`).expect(403);

    const [credit] = await db.select().from(orderCredit).where(eq(orderCredit.orderId, orderId));
    expect(credit.status).toBe("outstanding");
    expect(parseFloat(String(credit.amountOutstanding))).toBe(125.5);
  });

  it("settles the customer's outstanding credit through the ledger when marking debt paid", async () => {
    await db.insert(orderCredit).values({
      orderId,
      orgId,
      customerId,
      amountGiven: "125.50",
      amountOutstanding: "125.50",
      status: "outstanding",
      givenOn: "2026-08-01",
    });

    const res = await request(app).post(`/api/tick-customers/${customerId}/mark-paid`).expect(200);
    expect(res.body.ordersSettled).toBe(1);
    expect(res.body.amountSettled).toBe(125.5);

    const [credit] = await db.select().from(orderCredit).where(eq(orderCredit.orderId, orderId));
    expect(credit.status).toBe("settled");
    expect(parseFloat(String(credit.amountOutstanding))).toBe(0);

    const payments = await db.select().from(creditPayments).where(eq(creditPayments.orderId, orderId));
    expect(payments).toHaveLength(1);
    expect(payments[0].recordedByUserId).toBe("test-admin");
  });
});
