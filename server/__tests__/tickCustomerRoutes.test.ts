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
      req.user = { id: "test-admin", role: "ADMIN" };
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

    await request(app).delete(`/api/tick-customers/${customerId}`).expect(200);

    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order.status).toBe("pending");
    expect(order.settledTotal).toBeNull();
    expect(order.settledAt).toBeNull();

    const [credit] = await db.select().from(orderCredit).where(eq(orderCredit.orderId, orderId));
    expect(credit.status).toBe("written_off");
    expect(parseFloat(String(credit.amountOutstanding))).toBe(0);

    const payments = await db.select().from(creditPayments).where(eq(creditPayments.orderId, orderId));
    expect(payments).toHaveLength(0);
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

    // Clearing the whole tab needs the exact balance being cleared.
    const res = await request(app)
      .post(`/api/tick-customers/${customerId}/mark-paid`)
      .send({ expectedBalance: 125.5 })
      .expect(200);
    expect(res.body.ordersSettled).toBe(1);
    expect(res.body.amountSettled).toBe(125.5);

    const [credit] = await db.select().from(orderCredit).where(eq(orderCredit.orderId, orderId));
    expect(credit.status).toBe("settled");
    expect(parseFloat(String(credit.amountOutstanding))).toBe(0);

    const payments = await db.select().from(creditPayments).where(eq(creditPayments.orderId, orderId));
    expect(payments).toHaveLength(1);
    expect(payments[0].recordedByUserId).toBe("test-admin");
  });

  it("groups two credit sales for the same customer into one entry and lists both orders", async () => {
    const orderId2 = randomUUID();
    await db.insert(orders).values({
      id: orderId2,
      orgId,
      customerId,
      total: "60.00",
      paymentMethod: "tick",
      status: "pending",
    } as never);
    await db.insert(orderCredit).values([
      {
        orderId,
        orgId,
        customerId,
        amountGiven: "125.50",
        amountOutstanding: "125.50",
        status: "outstanding",
        givenOn: "2026-08-01",
      },
      {
        orderId: orderId2,
        orgId,
        customerId,
        amountGiven: "60.00",
        amountOutstanding: "20.00",
        status: "partial",
        givenOn: "2026-08-05",
      },
    ]);

    const res = await request(app).get("/api/tick-customers").expect(200);
    const entries = res.body.filter((c: any) => c.id === customerId);
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry.totalDebt).toBe(145.5);
    expect(entry.orders).toHaveLength(2);

    const byId = new Map(entry.orders.map((o: any) => [o.id, o]));
    const first = byId.get(orderId);
    expect(first.shortCode).toBe(orderId.slice(0, 8));
    expect(first.status).toBe("pending");
    expect(first.amountOutstanding).toBe(125.5);

    const second = byId.get(orderId2);
    expect(second.status).toBe("partial");
    expect(second.amountOutstanding).toBe(20);
    expect(second.amountGiven).toBe(60);
  });

  it("leaves a fully settled customer off the credit list", async () => {
    await db.insert(orderCredit).values({
      orderId,
      orgId,
      customerId,
      amountGiven: "125.50",
      amountOutstanding: "0",
      status: "settled",
      givenOn: "2026-08-01",
      settledOn: "2026-08-10",
    });

    const res = await request(app).get("/api/tick-customers").expect(200);
    expect(res.body.find((c: any) => c.id === customerId)).toBeUndefined();
  });
});
