/**
 * ARC-024: the Staff KPI report used to scale whatever handful of KPIs it
 * could measure (order accuracy, satisfaction) up to the full 7-KPI bonus
 * scheme — a cashier with one refund-free order and no satisfaction score at
 * all scored 100% accuracy on 1 measured KPI, projected to "7/7", and was
 * awarded PLATINUM and a payable £150. This reproduces exactly that seed
 * (one refund-free completed order, no satisfaction score) and asserts the
 * report now reports "INSUFFICIENT DATA" with no £ figure instead of a tier,
 * and that attribution uses `completed_cashier_id` — the column that
 * actually says who did the commission-earning work — not the legacy,
 * last-writer-wins `cashier_id` column.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { orders, organizations, cashierProfiles, satisfactionScores } from "@shared/schema";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("Staff KPI does not extrapolate a tier from partial data", () => {
  let orgId: string;
  let cashierId: string;
  let otherCashierId: string;
  let db: (typeof import("../db"))["db"];
  let staffKpiPerformance: (typeof import("../services/reportsEngine"))["staffKpiPerformance"];

  beforeEach(async () => {
    ({ db } = await import("../db"));
    ({ staffKpiPerformance } = await import("../services/reportsEngine"));

    orgId = randomUUID();
    cashierId = randomUUID();
    otherCashierId = randomUUID();
    await db.insert(organizations).values({ id: orgId, name: "Staff KPI Test Org" });
    await db.insert(cashierProfiles).values([
      { id: cashierId, orgId, cashierCode: "T1", displayName: "Test Cashier", isActive: true },
      { id: otherCashierId, orgId, cashierCode: "T2", displayName: "Other Cashier", isActive: true },
    ] as never);
  });

  afterEach(async () => {
    await db.delete(satisfactionScores).where(eq(satisfactionScores.orgId, orgId));
    await db.delete(orders).where(eq(orders.orgId, orgId));
    await db.delete(cashierProfiles).where(inArray(cashierProfiles.id, [cashierId, otherCashierId]));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("reports INSUFFICIENT DATA — never a tier or a £ bonus — from a single refund-free order", async () => {
    await db.insert(orders).values({
      id: randomUUID(),
      orgId,
      total: "50.00",
      paymentMethod: "cash",
      status: "completed",
      completedCashierId: cashierId,
      settledTotal: "50.00",
      settledAt: new Date("2026-01-15T10:00:00.000Z"),
    } as never);

    const report = await staffKpiPerformance(
      orgId,
      new Date("2026-01-12T00:00:00.000Z"),
      new Date("2026-01-18T00:00:00.000Z"),
    );

    const row = report.rows.find((r: any) => r.staff === "Test Cashier") as any;
    expect(row).toBeDefined();
    expect(row.ordersHandled).toBe(1);
    // Only accuracy is measurable here (no satisfaction score at all) — the
    // old code projected this straight to PLATINUM / £150.
    expect(row.kpisMeasured).toBe(1);
    expect(row.bonusTier).toBe("INSUFFICIENT DATA");
    expect(row.bonusPayable).toBeNull();
    expect(report.summary.platinum).toBe(0);
    expect(report.summary.totalBonus).toBe(0);
  });

  it("attributes orders by completed_cashier_id, not the legacy cashier_id column", async () => {
    await db.insert(orders).values({
      id: randomUUID(),
      orgId,
      total: "50.00",
      paymentMethod: "cash",
      status: "completed",
      // Legacy column points at the OTHER cashier; completedCashierId is who
      // actually did the commission-earning work.
      cashierId: otherCashierId,
      completedCashierId: cashierId,
      settledTotal: "50.00",
      settledAt: new Date("2026-01-15T10:00:00.000Z"),
    } as never);

    const report = await staffKpiPerformance(
      orgId,
      new Date("2026-01-12T00:00:00.000Z"),
      new Date("2026-01-18T00:00:00.000Z"),
    );

    const attributed = report.rows.find((r: any) => r.staff === "Test Cashier") as any;
    const notAttributed = report.rows.find((r: any) => r.staff === "Other Cashier") as any;
    expect(attributed.ordersHandled).toBe(1);
    expect(notAttributed.ordersHandled).toBe(0);
  });

  it("excludes a non-settled order from ordersHandled", async () => {
    await db.insert(orders).values({
      id: randomUUID(),
      orgId,
      total: "50.00",
      paymentMethod: "cash",
      status: "pending",
      completedCashierId: cashierId,
      createdAt: new Date("2026-01-15T10:00:00.000Z"),
    } as never);

    const report = await staffKpiPerformance(
      orgId,
      new Date("2026-01-12T00:00:00.000Z"),
      new Date("2026-01-18T00:00:00.000Z"),
    );

    const row = report.rows.find((r: any) => r.staff === "Test Cashier") as any;
    expect(row.ordersHandled).toBe(0);
  });
});
