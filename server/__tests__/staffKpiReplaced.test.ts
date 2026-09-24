/**
 * STF-01 (v1.2 Phase 7B): ARC-T2-002 is Staff Performance now, replacing the
 * Staff KPI report that STF-FN1 hid.
 *
 * Pinned against both data shapes: since the lazy-shift change, orders carry
 * the person on `completed_user_id` and no cashier code at all
 * (`completed_cashier_id` NULL); orders from before 27 Aug 2026 carry both
 * (migration 057 filled `completed_user_id` from the shift opener). The old
 * report counted codes, so the first person was missing and the second sat on
 * zero. Keyed by login, both appear with their own orders, and there is no
 * bonus tier or £ bonus anywhere (Q16).
 *
 * Also here: the unscoped ARC-T2-002 JSON stays admin only (it rates managers
 * too: Q12), while the rest of Evidence stays open to managers. The page
 * itself uses /api/evidence/staff-performance, cut per viewer.
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

  it("STF-01: every person appears, keyed by login, with the orders they completed — never a bonus", async () => {
    const { staffPerformanceReport } = await import("../services/reportsEngine");
    const report = await staffPerformanceReport(orgId, WEEK.from, WEEK.to);
    const person = (name: string) => report.rows.find((r) => r.staff === name) as { completed: number; salesCompleted: number } | undefined;
    expect(person("Nina Now")?.completed).toBe(2);
    expect(person("Nina Now")?.salesCompleted).toBe(50);
    expect(person("Olly Old")?.completed).toBe(1);
    expect(person("Total")?.salesCompleted).toBe(60);
    const keys = Object.keys(report.rows[0]);
    expect(keys.some((k) => /bonus|tier/i.test(k))).toBe(false);
    expect(Object.keys(report.summary).some((k) => /bonus/i.test(k))).toBe(false);
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
