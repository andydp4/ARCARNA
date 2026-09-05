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

  beforeEach(async () => {
    ({ db } = await import("../db"));
    const { registerTickCustomerRoutes } = await import("../routes/tickCustomers");

    orgId = randomUUID();
    customerId = randomUUID();
    orderId = randomUUID();

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
      req.orgContext = { orgId, locationId: null, role: "ADMIN" };
      req.user = { id: "test-admin" };
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

  it("stamps settlement fields when removing a customer from the credit list", async () => {
    await request(app).delete(`/api/tick-customers/${customerId}`).expect(200);

    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order.status).toBe("completed");
    expect(order.settledTotal).toBe("125.50");
    expect(order.settledAt).toBeInstanceOf(Date);
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
