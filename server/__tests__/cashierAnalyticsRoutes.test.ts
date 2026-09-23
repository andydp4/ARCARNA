/**
 * GET /api/cashier-analytics — the Payroll table, one row per person
 * (STF-FN3), against a real database.
 *
 * - Rows are keyed by the person (`user_id`), so someone with no cashier code
 *   — everyone trading since the lazy-shift change — appears with their
 *   orders. The old table looped over cashier codes and showed nobody.
 * - Orders count only if completed by that person, not personal use, and
 *   settled inside the trading days asked for.
 * - Sales per active hour divides by first-to-last action on the shift, not
 *   open-to-close (the daily close stamps closedAt whenever it runs).
 * - A manager and an admin see cashiers' pay and their own, never managers'
 *   (Q12, Q13a). The owner sees everyone.
 * - The CSV export is admin only and logged (Q12).
 *
 * In CI's unit-db job by explicit file name (.github/workflows/ci.yml).
 */
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  adminAuditLogs,
  allowedUsers,
  cashierShifts,
  cashierShiftSummaries,
  orders,
  organizations,
} from "@shared/schema";

const hasDb = !!process.env.DATABASE_URL;

// A fixed trading day well in the past (Europe/London, GMT in January), so
// the window is exact and nothing live can land in it.
const DAY = "2026-01-14";
const AT = (hhmm: string) => new Date(`${DAY}T${hhmm}:00.000Z`);

describe.skipIf(!hasDb)("GET /api/cashier-analytics: one row per person", () => {
  let db: (typeof import("../db"))["db"];
  let orgId: string;
  const tag = randomUUID().slice(0, 8);
  const ids = {
    cashier: `pay-cashier-${tag}`,
    manager: `pay-manager-${tag}`,
    admin: `pay-admin-${tag}`,
    owner: `pay-owner-${tag}`,
  };

  function appAs(role: string, userId: string) {
    const scoped: RequestHandler = (req: any, _res, next) => {
      req.orgContext = { orgId, locationId: null, role };
      req.user = { id: userId, role };
      next();
    };
    const app = express();
    app.use(express.json());
    return import("../routes/cashierAnalytics").then(({ registerCashierAnalyticsRoutes }) => {
      registerCashierAnalyticsRoutes(app, [scoped]);
      return app;
    });
  }

  beforeEach(async () => {
    process.env.DEV_AUTH_BYPASS = "0";
    ({ db } = await import("../db"));
    orgId = randomUUID();
    await db.insert(organizations).values({ id: orgId, name: "Payroll Per Person Test" });
    await db.insert(allowedUsers).values([
      { replitUserId: ids.cashier, authUserId: ids.cashier, name: "Casey Cashier", role: "CASHIER", orgId },
      { replitUserId: ids.manager, authUserId: ids.manager, name: "Morgan Manager", role: "MANAGER", orgId },
      { replitUserId: ids.admin, authUserId: ids.admin, name: "Ada Admin", role: "ADMIN", orgId },
    ] as never);

    // Lazy shifts: no cashier code, keyed by the person. The cashier worked
    // 10:00 to 14:00 (4 active hours) but the daily close stamped 06:00 the
    // next day — open-to-close would read 20 hours.
    const [cShift, mShift] = await db
      .insert(cashierShifts)
      .values([
        {
          orgId,
          userId: ids.cashier,
          tradingDay: DAY,
          openedByUserId: ids.cashier,
          openedAt: AT("10:00"),
          lastActivityAt: AT("14:00"),
          closedAt: new Date(`2026-01-15T06:00:00.000Z`),
          status: "auto_closed",
        },
        {
          orgId,
          userId: ids.manager,
          tradingDay: DAY,
          openedByUserId: ids.manager,
          openedAt: AT("09:00"),
          lastActivityAt: AT("11:00"),
          status: "closed",
          closeReason: "manual",
          closedAt: AT("11:00"),
        },
      ] as never)
      .returning();
    await db.insert(cashierShiftSummaries).values([
      { orgId, shiftId: cShift.id, userId: ids.cashier, grossSales: "80.00", netSalesProfit: "30.00", commissionAmount: "3.00", closedAt: AT("23:00") },
      { orgId, shiftId: mShift.id, userId: ids.manager, grossSales: "500.00", netSalesProfit: "200.00", commissionAmount: "20.00", closedAt: AT("11:00") },
    ] as never);

    const settled = (userId: string, total: string, hhmm: string, extra: Record<string, unknown> = {}) => ({
      orgId,
      completedUserId: userId,
      total,
      settledTotal: total,
      settledAt: AT(hhmm),
      paymentMethod: "cash",
      status: "completed",
      ...extra,
    });
    await db.insert(orders).values([
      settled(ids.cashier, "50.00", "11:00"),
      settled(ids.cashier, "30.00", "13:00"),
      // None of these count: open, personal use, or settled on another day.
      { ...settled(ids.cashier, "999.00", "12:00"), status: "pending", settledAt: null, settledTotal: null },
      settled(ids.cashier, "999.00", "12:30", { paymentMethod: "personal_use" }),
      { ...settled(ids.cashier, "999.00", "12:00"), settledAt: new Date("2026-01-20T12:00:00.000Z") },
      settled(ids.manager, "500.00", "10:00"),
    ] as never);
  });

  afterEach(async () => {
    await db.delete(adminAuditLogs).where(eq(adminAuditLogs.orgId, orgId));
    await db.delete(orders).where(eq(orders.orgId, orgId));
    await db.delete(cashierShiftSummaries).where(eq(cashierShiftSummaries.orgId, orgId));
    await db.delete(cashierShifts).where(eq(cashierShifts.orgId, orgId));
    await db.delete(allowedUsers).where(inArray(allowedUsers.replitUserId, Object.values(ids)));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  const range = `from=${DAY}&to=${DAY}`;

  it("lists a person with no cashier code, with their completed orders and sales per active hour", async () => {
    const app = await appAs("SUPER_ADMIN", ids.owner);
    const res = await request(app).get(`/api/cashier-analytics?${range}`).expect(200);
    const casey = res.body.metrics.find((m: any) => m.key === ids.cashier);
    expect(casey).toMatchObject({
      name: "Casey Cashier",
      totalSales: 80,
      commissionEarned: 3,
      shiftCount: 1,
      activeHours: 4,
      orderCount: 2,
      averageOrderValue: 40,
      // £80 over 4 active hours, not over the 20 hours to the daily close.
      salesPerActiveHour: 20,
    });
    expect(res.body).not.toHaveProperty("leaderboards");
  });

  it("the owner sees managers' pay; a manager and an admin see cashiers' and their own only", async () => {
    const keysFor = async (role: string, userId: string) => {
      const app = await appAs(role, userId);
      const res = await request(app).get(`/api/cashier-analytics?${range}`).expect(200);
      return (res.body.metrics as Array<{ key: string }>).map((m) => m.key).sort();
    };
    expect(await keysFor("SUPER_ADMIN", ids.owner)).toEqual([ids.cashier, ids.manager].sort());
    expect(await keysFor("ADMIN", ids.admin)).toEqual([ids.cashier]);
    expect(await keysFor("MANAGER", ids.manager)).toEqual([ids.cashier, ids.manager].sort());
    expect(await keysFor("MANAGER", `someone-else-${tag}`)).toEqual([ids.cashier]);
  });

  it("filters to one person by staffId", async () => {
    const app = await appAs("SUPER_ADMIN", ids.owner);
    const res = await request(app).get(`/api/cashier-analytics?${range}&staffId=${ids.manager}`).expect(200);
    expect(res.body.metrics.map((m: any) => m.key)).toEqual([ids.manager]);
  });

  it("refuses a cashier outright", async () => {
    const app = await appAs("CASHIER", ids.cashier);
    await request(app).get(`/api/cashier-analytics?${range}`).expect(403);
  });

  it("the CSV export is admin only, logged, and leaves managers' pay out for an admin", async () => {
    const managerApp = await appAs("MANAGER", ids.manager);
    await request(managerApp).get(`/api/cashier-analytics/export.csv?from=${DAY}&to=2026-01-15`).expect(403);

    const adminApp = await appAs("ADMIN", ids.admin);
    const res = await request(adminApp).get(`/api/cashier-analytics/export.csv?from=${DAY}&to=2026-01-15`).expect(200);
    expect(res.text).toContain("Casey Cashier");
    expect(res.text).not.toContain("500.00");

    const logs = await db
      .select()
      .from(adminAuditLogs)
      .where(and(eq(adminAuditLogs.orgId, orgId), eq(adminAuditLogs.action, "export.payroll")));
    expect(logs).toHaveLength(1);
    expect(logs[0].actorUserId).toBe(ids.admin);
  });
});
