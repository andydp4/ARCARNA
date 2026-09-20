/**
 * GET /api/cashier-analytics's `orderAgg` (server/routes/cashierAnalytics.ts)
 * used to sum every order tied to a cashier — pending, on-hold, even
 * personal_use — into orderCount/averageOrderValue/salesPerHour, regardless
 * of whether that order was ever actually completed. An order still open may
 * never become a sale at all, and personal_use never is one (it's a stock
 * write-off, excluded everywhere else this figure is computed — see
 * shared/reports/cashierShiftReport.ts's `salesOrders` filter). This proves
 * only completed, non-personal-use orders feed those figures.
 *
 * Runs against a real database — excluded from the no-DB run in
 * vitest.config.ts, included in `unit-db` by explicit file name.
 */
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { cashierProfiles, orders, organizations } from "@shared/schema";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("GET /api/cashier-analytics order figures", () => {
  let db: (typeof import("../db"))["db"];
  let app: express.Express;
  let orgId: string;
  let cashierId: string;

  beforeEach(async () => {
    ({ db } = await import("../db"));
    const { registerCashierAnalyticsRoutes } = await import("../routes/cashierAnalytics");

    orgId = randomUUID();
    await db.insert(organizations).values({ id: orgId, name: "Cashier Analytics Test" });
    const [cashier] = await db
      .insert(cashierProfiles)
      .values({ orgId, cashierCode: "T1", displayName: "Test Cashier" })
      .returning();
    cashierId = cashier.id;

    const scoped: RequestHandler = (req: any, _res, next) => {
      req.orgContext = { orgId, locationId: null, role: "ADMIN" };
      req.user = { id: "test-admin", role: "ADMIN" };
      next();
    };

    app = express();
    app.use(express.json());
    registerCashierAnalyticsRoutes(app, [scoped]);
  });

  afterEach(async () => {
    await db.delete(orders).where(eq(orders.orgId, orgId));
    await db.delete(cashierProfiles).where(eq(cashierProfiles.orgId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("counts only completed, non-personal-use orders toward orderCount and averageOrderValue", async () => {
    await db.insert(orders).values([
      { orgId, cashierId, total: "50.00", paymentMethod: "cash", status: "completed" },
      { orgId, cashierId, total: "30.00", paymentMethod: "cash", status: "completed" },
      // None of these should contribute — each total is deliberately far from
      // the completed pair's, so a leak shows up unmissably in the average.
      { orgId, cashierId, total: "999.00", paymentMethod: "cash", status: "pending" },
      { orgId, cashierId, total: "999.00", paymentMethod: "cash", status: "on-hold" },
      { orgId, cashierId, total: "999.00", paymentMethod: "personal_use", status: "completed" },
    ] as never);

    const res = await request(app).get("/api/cashier-analytics").expect(200);

    const metric = res.body.metrics.find((m: { cashierId: string }) => m.cashierId === cashierId);
    expect(metric).toBeDefined();
    expect(metric.orderCount).toBe(2);
    expect(metric.averageOrderValue).toBe(40);
  });

  it("reports zero order figures for a cashier with only open or personal_use orders", async () => {
    await db.insert(orders).values([
      { orgId, cashierId, total: "999.00", paymentMethod: "cash", status: "pending" },
      { orgId, cashierId, total: "999.00", paymentMethod: "tick", status: "awaiting-customer" },
    ] as never);

    const res = await request(app).get("/api/cashier-analytics").expect(200);

    const metric = res.body.metrics.find((m: { cashierId: string }) => m.cashierId === cashierId);
    expect(metric).toBeDefined();
    expect(metric.orderCount).toBe(0);
    expect(metric.averageOrderValue).toBe(0);
  });
});
