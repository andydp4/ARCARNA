/**
 * ARC-020/023/027/033: Daily Sales and Weekly Sales used to sum EVERY order
 * in a server-local-midnight `created_at` window regardless of status, with
 * no refund netting, and bucketed anything that wasn't cash/web/reseller as
 * "Card". This asserts the fixed reports:
 *  - agree with {@link settledRevenueByTradingDay} — the same figure Control
 *    Centre shows — for the same trading day/week (ARC-023/027);
 *  - exclude a pending order sitting in the same window (ARC-020's root
 *    cause, reproduced directly rather than only via the Truths hub); and
 *  - bucket tick, gift card and split-tender sales into real buckets instead
 *    of silently defaulting them to "Card" (ARC-033).
 *
 * All settlement instants are in January, when Europe/London is GMT (UTC+0),
 * so a UTC ISO instant and the London wall-clock time coincide and the test
 * is not itself sensitive to the BST bug it is guarding against.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { orders, organizations, orderPayments } from "@shared/schema";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("Daily/Weekly Sales match the settled-revenue definition", () => {
  let orgId: string;
  let db: (typeof import("../db"))["db"];
  let dailySalesSummary: (typeof import("../services/reportsEngine"))["dailySalesSummary"];
  let weeklySalesSummary: (typeof import("../services/reportsEngine"))["weeklySalesSummary"];
  let settledRevenueByTradingDay: (typeof import("../services/revenue"))["settledRevenueByTradingDay"];

  beforeEach(async () => {
    ({ db } = await import("../db"));
    ({ dailySalesSummary, weeklySalesSummary } = await import("../services/reportsEngine"));
    ({ settledRevenueByTradingDay } = await import("../services/revenue"));

    orgId = randomUUID();
    // No explicit timezone → orgTimeZone() defaults to Europe/London, same as production.
    await db.insert(organizations).values({ id: orgId, name: "Reports Revenue Definition Test" });
  });

  afterEach(async () => {
    await db.delete(orderPayments).where(eq(orderPayments.orgId, orgId));
    await db.delete(orders).where(eq(orders.orgId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("excludes a pending order and matches settledRevenueByTradingDay for the same trading day", async () => {
    await db.insert(orders).values([
      {
        id: randomUUID(),
        orgId,
        total: "100.00",
        paymentMethod: "cash",
        status: "completed",
        settledTotal: "100.00",
        settledAt: new Date("2026-01-15T10:00:00.000Z"),
      },
      {
        // Open work, not money — must never be counted as revenue.
        id: randomUUID(),
        orgId,
        total: "500.00",
        paymentMethod: "cash",
        status: "pending",
        createdAt: new Date("2026-01-15T11:00:00.000Z"),
      },
    ] as never);

    const [report, controlCentreDay] = await Promise.all([
      dailySalesSummary(orgId, new Date("2026-01-15T00:00:00.000Z")),
      settledRevenueByTradingDay(orgId, "Europe/London", "2026-01-15", "2026-01-15").then(
        (m) => m.get("2026-01-15"),
      ),
    ]);

    expect(report.summary.totalRevenue).toBe(100);
    expect(report.summary.ordersProcessed).toBe(1);
    expect(controlCentreDay?.revenue).toBe(100);
    expect(report.summary.totalRevenue).toBe(controlCentreDay?.revenue);
  });

  it("books a 05:30 sale to the previous trading day, not the calendar day it falls on", async () => {
    await db.insert(orders).values({
      id: randomUUID(),
      orgId,
      total: "40.00",
      paymentMethod: "cash",
      status: "completed",
      settledTotal: "40.00",
      settledAt: new Date("2026-01-15T05:30:00.000Z"),
    } as never);

    const dayOf14th = await dailySalesSummary(orgId, new Date("2026-01-14T00:00:00.000Z"));
    const dayOf15th = await dailySalesSummary(orgId, new Date("2026-01-15T00:00:00.000Z"));

    expect(dayOf14th.summary.totalRevenue).toBe(40);
    expect(dayOf15th.summary.totalRevenue).toBe(0);
  });

  it("buckets tick, gift card and split-tender sales into real buckets, never defaulting to Card", async () => {
    const tickOrderId = randomUUID();
    const giftCardOrderId = randomUUID();
    const splitOrderId = randomUUID();

    await db.insert(orders).values([
      {
        id: tickOrderId,
        orgId,
        total: "80.00",
        paymentMethod: "tick",
        status: "completed",
        settledTotal: "80.00",
        settledAt: new Date("2026-01-15T10:00:00.000Z"),
      },
      {
        id: giftCardOrderId,
        orgId,
        total: "25.00",
        paymentMethod: "gift_card",
        status: "completed",
        settledTotal: "25.00",
        settledAt: new Date("2026-01-15T11:00:00.000Z"),
      },
      {
        id: splitOrderId,
        orgId,
        total: "50.00",
        paymentMethod: "cash", // legacy single-value label; the split legs below are authoritative
        status: "completed",
        settledTotal: "50.00",
        settledAt: new Date("2026-01-15T12:00:00.000Z"),
      },
    ] as never);
    await db.insert(orderPayments).values([
      { orgId, orderId: splitOrderId, method: "cash", amount: "30.00" },
      { orgId, orderId: splitOrderId, method: "card", amount: "20.00" },
    ] as never);

    const report = await dailySalesSummary(orgId, new Date("2026-01-15T00:00:00.000Z"));

    expect(report.summary.tickRevenue).toBe(80);
    expect(report.summary.giftCardRevenue).toBe(25);
    // The split sale: 30 cash + 20 card, not 50 lumped into Card.
    expect(report.summary.cashRevenue).toBe(30);
    expect(report.summary.cardRevenue).toBe(20);
    expect(report.summary.totalRevenue).toBe(80 + 25 + 50);

    const rowFor = (label: string) => report.rows.find((r: any) => r.channel === label) as any;
    expect(rowFor("Credit (Tick)")?.revenue).toBe(80);
    expect(rowFor("Gift Card")?.revenue).toBe(25);
  });

  it("weekly summary matches the sum of settledRevenueByTradingDay across the week", async () => {
    await db.insert(orders).values([
      {
        id: randomUUID(),
        orgId,
        total: "100.00",
        paymentMethod: "cash",
        status: "completed",
        settledTotal: "100.00",
        settledAt: new Date("2026-01-13T10:00:00.000Z"), // Tuesday
      },
      {
        id: randomUUID(),
        orgId,
        total: "200.00",
        paymentMethod: "card",
        status: "completed",
        settledTotal: "200.00",
        settledAt: new Date("2026-01-16T10:00:00.000Z"), // Friday
      },
      {
        // Open work in the same week — must not inflate the week's total.
        id: randomUUID(),
        orgId,
        total: "9999.00",
        paymentMethod: "cash",
        status: "pending",
        createdAt: new Date("2026-01-14T10:00:00.000Z"),
      },
    ] as never);

    // Monday 12th to Sunday 18th.
    const report = await weeklySalesSummary(
      orgId,
      new Date("2026-01-12T00:00:00.000Z"),
      new Date("2026-01-18T00:00:00.000Z"),
    );

    const byDay = await settledRevenueByTradingDay(orgId, "Europe/London", "2026-01-12", "2026-01-18");
    let expectedTotal = 0;
    for (const kpi of byDay.values()) expectedTotal += kpi.revenue;

    expect(expectedTotal).toBe(300);
    expect(report.summary.totalRevenue).toBe(300);
    expect(report.summary.totalOrders).toBe(2);
  });
});
