/**
 * v1.2.1 money audit (M2): a manager could delete a settled sale from a
 * trading day the 06:00 close had already frozen, rewriting that day's
 * takings, drawer, shift sheet and commission. Reopening the same sale was
 * already refused; deleting it is now refused the same way. A sale on a day
 * still open can be deleted as before.
 *
 * Real route, real database.
 */
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { dailyCloseRuns, orderEvents, orders, organizations } from "@shared/schema";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("deleting a settled sale from a closed day", () => {
  let db: (typeof import("../db"))["db"];
  let app: express.Express;
  let orgId: string;

  // 11 Sept 2026, 14:00 BST: the 11th's trading day.
  const SETTLED_AT = new Date("2026-09-11T13:00:00.000Z");

  async function settledSale(): Promise<string> {
    const [o] = await db
      .insert(orders)
      .values({
        orgId,
        total: "30.00",
        settledTotal: "30.00",
        paymentMethod: "cash",
        status: "completed",
        settledAt: SETTLED_AT,
        createdAt: SETTLED_AT,
      } as never)
      .returning();
    return o.id;
  }

  beforeEach(async () => {
    ({ db } = await import("../db"));
    const { registerOrderRoutes } = await import("../routes/orders");
    orgId = randomUUID();
    await db.insert(organizations).values({ id: orgId, name: "Delete Closed Day Test", timezone: "Europe/London" } as never);
    const scoped: RequestHandler = (req: any, _res, next) => {
      req.orgContext = { orgId, locationId: null, role: "MANAGER" };
      req.user = { id: "seed-manager", role: "MANAGER" };
      req.isAuthenticated = () => true;
      next();
    };
    app = express();
    app.use(express.json());
    registerOrderRoutes(app, [scoped]);
  });

  afterEach(async () => {
    await db.delete(orderEvents).where(eq(orderEvents.orgId, orgId));
    await db.delete(orders).where(eq(orders.orgId, orgId));
    await db.delete(dailyCloseRuns).where(eq(dailyCloseRuns.orgId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("refuses once the sale's trading day has closed, and leaves the sale in place", async () => {
    const id = await settledSale();
    await db.insert(dailyCloseRuns).values({ orgId, tradingDay: "2026-09-11", orderCount: 1, grossSales: "30.00", cashSales: "30.00" });

    const res = await request(app).delete(`/api/orders/${id}`).expect(409);
    expect(res.body.code).toBe("ORDER_DELETE_CLOSED_DAY");
    expect(await db.select().from(orders).where(eq(orders.id, id))).toHaveLength(1);
  });

  it("still deletes a settled sale whose day has not closed", async () => {
    const id = await settledSale();
    await request(app).delete(`/api/orders/${id}`).expect(200);
    expect(await db.select().from(orders).where(eq(orders.id, id))).toHaveLength(0);
  });
});
