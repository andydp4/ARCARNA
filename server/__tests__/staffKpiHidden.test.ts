/**
 * STF-FN1: the Staff KPI Evidence (ARC-T2-002) is hidden while it is rebuilt.
 *
 * Why it is hidden, pinned against today's data shape: since the lazy-shift
 * change, orders carry the person on `completed_user_id` and no cashier code
 * at all (`completed_cashier_id` NULL). The report still builds its staff list
 * from cashier codes, so someone who sold all week does not appear, and the
 * old code profiles sit on zero. Orders from before 27 Aug 2026 carry both
 * (migration 057 filled `completed_user_id` from the shift opener), so both
 * shapes are seeded.
 *
 * The `it.fails` case is the rebuild's (STF-01) first test: it describes what
 * the report must do and fails today. When STF-01 lands, it starts passing,
 * vitest reports it, and it becomes a plain `it`.
 *
 * Also here: the server keeps ARC-T2-002 to admins (it rates managers too:
 * Q12), while the rest of Evidence stays open to managers.
 *
 * In CI's unit-db job by explicit file name (.github/workflows/ci.yml).
 */
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { allowedUsers, cashierProfiles, orders, organizations } from "@shared/schema";

const hasDb = !!process.env.DATABASE_URL;
const WEEK = { from: new Date("2026-01-12T00:00:00.000Z"), to: new Date("2026-01-18T00:00:00.000Z") };

describe.skipIf(!hasDb)("Staff KPI (ARC-T2-002) on today's data shape", () => {
  let db: (typeof import("../db"))["db"];
  let orgId: string;
  let legacyCodeId: string;
  const tag = randomUUID().slice(0, 8);
  const loginOnly = `user_kpi_now_${tag}`;
  const legacyUser = `user_kpi_old_${tag}`;

  beforeEach(async () => {
    process.env.DEV_AUTH_BYPASS = "0";
    ({ db } = await import("../db"));
    orgId = randomUUID();
    legacyCodeId = randomUUID();
    await db.insert(organizations).values({ id: orgId, name: "Staff KPI Shape Org" });
    await db.insert(allowedUsers).values([
      { replitUserId: loginOnly, authUserId: loginOnly, name: "Nina Now", role: "CASHIER", orgId },
      { replitUserId: legacyUser, authUserId: legacyUser, name: "Olly Old", role: "CASHIER", orgId },
    ] as never);
    await db.insert(cashierProfiles).values({
      id: legacyCodeId,
      orgId,
      cashierCode: "OLD1",
      displayName: "Olly Old",
      isActive: true,
    } as never);
    const settled = (hhmm: string) => new Date(`2026-01-15T${hhmm}:00.000Z`);
    await db.insert(orders).values([
      // Today's shape: the person, and no code.
      { orgId, total: "20.00", settledTotal: "20.00", settledAt: settled("10:00"), paymentMethod: "cash", status: "completed", completedUserId: loginOnly, completedCashierId: null },
      { orgId, total: "30.00", settledTotal: "30.00", settledAt: settled("11:00"), paymentMethod: "cash", status: "completed", completedUserId: loginOnly, completedCashierId: null },
      // Pre-057 shape: a code, and the person migration 057 inferred.
      { orgId, total: "10.00", settledTotal: "10.00", settledAt: settled("12:00"), paymentMethod: "cash", status: "completed", completedUserId: legacyUser, completedCashierId: legacyCodeId },
    ] as never);
  });

  afterEach(async () => {
    await db.delete(orders).where(eq(orders.orgId, orgId));
    await db.delete(cashierProfiles).where(eq(cashierProfiles.orgId, orgId));
    await db.delete(allowedUsers).where(inArray(allowedUsers.replitUserId, [loginOnly, legacyUser]));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("is why the page is hidden: a person who sold this week is missing; only the old code shows", async () => {
    const { staffKpiPerformance } = await import("../services/reportsEngine");
    const report = await staffKpiPerformance(orgId, WEEK.from, WEEK.to);
    const names = report.rows.map((r) => r.staff);
    expect(names).toEqual(["Olly Old"]);
    expect(names).not.toContain("Nina Now");
    // Pin the payload shape the rebuild replaces, so a change to it is seen.
    expect(Object.keys(report.rows[0]).sort()).toEqual(
      [
        "bonusPayable",
        "bonusTier",
        "kpisAtTarget",
        "kpisMeasured",
        "kpisTotal",
        "orderAccuracyRate",
        "ordersHandled",
        "satisfactionScore",
        "staff",
      ].sort(),
    );
  });

  it.fails("STF-01: every person appears, keyed by login, with the orders they completed", async () => {
    const { staffKpiPerformance } = await import("../services/reportsEngine");
    const report = await staffKpiPerformance(orgId, WEEK.from, WEEK.to);
    const nina = report.rows.find((r) => r.staff === "Nina Now") as { ordersHandled: number } | undefined;
    expect(nina?.ordersHandled).toBe(2);
  });

  it("the server keeps ARC-T2-002 to admins; other Evidence stays open to managers", async () => {
    const appAs = async (role: string) => {
      const { registerReportRoutes } = await import("../routes/reports");
      const scoped: RequestHandler = (req: any, _res, next) => {
        req.orgContext = { orgId, locationId: null, role };
        req.user = { id: `kpi-${role.toLowerCase()}`, role };
        next();
      };
      const app = express();
      registerReportRoutes(app, [scoped]);
      return app;
    };
    const q = "from=2026-01-12&to=2026-01-18";
    const manager = await appAs("MANAGER");
    await request(manager).get(`/api/reports/ARC-T2-002?${q}`).expect(403);
    await request(manager).get(`/api/reports/arc-t2-002?${q}`).expect(403);
    await request(manager).get(`/api/reports/ARC-T1-004?${q}`).expect(200);
    const admin = await appAs("ADMIN");
    await request(admin).get(`/api/reports/ARC-T2-002?${q}`).expect(200);
    const cashier = await appAs("CASHIER");
    await request(cashier).get(`/api/reports/ARC-T1-004?${q}`).expect(403);
  });
});
