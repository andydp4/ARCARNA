import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { customers, orders, organizations } from "@shared/schema";

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
    await db.delete(orders).where(eq(orders.orgId, orgId));
    await db.delete(customers).where(eq(customers.orgId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("stamps settlement fields when marking tick debt paid", async () => {
    await request(app).post(`/api/tick-customers/${customerId}/mark-paid`).expect(200);

    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order.status).toBe("completed");
    expect(order.settledTotal).toBe("125.50");
    expect(order.settledAt).toBeInstanceOf(Date);
  });
});
