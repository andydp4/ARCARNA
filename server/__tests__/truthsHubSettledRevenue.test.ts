/**
 * ARC-020: the Truths hub's revenue / orders / AOV / revenue-by-day numbers
 * (GET /api/reports → storage.getReportData) filtered only on date + org —
 * pending, on-hold and cancelled orders all counted as revenue, with no
 * refund netting. Live seed data hit this directly: 77 of 85 orders were
 * `pending` and were still being added into "total revenue". This asserts
 * the fixed `getRevenueReports`/`getOrderReports` exclude a pending order and
 * match {@link settledRevenueByDay} — the same definition Control Centre
 * uses — for the same calendar-day range.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { orders, organizations, refunds } from "@shared/schema";
import { storage } from "../storage";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("Truths hub revenue matches the settled-revenue definition", () => {
  let orgId: string;
  let db: (typeof import("../db"))["db"];
  let settledRevenueByDay: (typeof import("../services/revenue"))["settledRevenueByDay"];

  beforeEach(async () => {
    ({ db } = await import("../db"));
    ({ settledRevenueByDay } = await import("../services/revenue"));
    orgId = randomUUID();
    await db.insert(organizations).values({ id: orgId, name: "Truths Hub Revenue Test" });
  });

  afterEach(async () => {
    await db.delete(refunds).where(eq(refunds.orgId, orgId));
    await db.delete(orders).where(eq(orders.orgId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("excludes pending orders and matches settledRevenueByDay for the same range (the seed-data bug)", async () => {
    // The seed-data shape this reproduces: mostly-pending orders alongside a
    // handful of genuinely settled ones.
    await db.insert(orders).values([
      {
        id: randomUUID(),
        orgId,
        total: "150.00",
        paymentMethod: "cash",
        status: "completed",
        settledTotal: "150.00",
        settledAt: new Date("2026-01-15T10:00:00.000Z"),
      },
      {
        id: randomUUID(),
        orgId,
        total: "5000.00",
        paymentMethod: "cash",
        status: "pending",
        createdAt: new Date("2026-01-15T11:00:00.000Z"),
      },
      {
        id: randomUUID(),
        orgId,
        total: "3000.00",
        paymentMethod: "card",
        status: "on-hold",
        createdAt: new Date("2026-01-15T12:00:00.000Z"),
      },
    ] as never);

    const fromDate = new Date("2026-01-15T00:00:00.000Z");
    const toDate = new Date("2026-01-15T23:59:59.999Z");
    const report = await storage.getReportData(fromDate, toDate, orgId);

    const expected = await settledRevenueByDay(orgId, "2026-01-15", "2026-01-15");
    const expectedRevenue = expected.get("2026-01-15")?.revenue ?? 0;
    const expectedTxns = expected.get("2026-01-15")?.txns ?? 0;

    expect(expectedRevenue).toBe(150);
    expect(report.revenue.total).toBe(150);
    expect(report.orders.total).toBe(expectedTxns);
    expect(report.orders.total).toBe(1);
    expect(report.orders.average).toBe(150);

    const day = report.revenue.byDay.find((d: any) => d.date === "2026-01-15");
    expect(day?.revenue).toBe(150);
    expect(day?.orders).toBe(1);
  });

  it("nets a refund out of total revenue", async () => {
    const orderId = randomUUID();
    await db.insert(orders).values({
      id: orderId,
      orgId,
      total: "200.00",
      paymentMethod: "cash",
      status: "completed",
      settledTotal: "200.00",
      settledAt: new Date("2026-01-15T10:00:00.000Z"),
    } as never);
    await db.insert(refunds).values({
      id: randomUUID(),
      orderId,
      orgId,
      cashierId: "test-cashier",
      reason: "damaged",
      refundMethod: "cash",
      total: "50.00",
      createdAt: new Date("2026-01-15T14:00:00.000Z"),
    } as never);

    const report = await storage.getReportData(
      new Date("2026-01-15T00:00:00.000Z"),
      new Date("2026-01-15T23:59:59.999Z"),
      orgId,
    );

    expect(report.revenue.total).toBe(150);
  });
});
