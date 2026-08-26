import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { orders, organizations, refunds } from "@shared/schema";

const hasDb = !!process.env.DATABASE_URL;

/** Local-midday timestamp for an ISO date, so a day never slips across a boundary. */
function at(date: string, hour = 12): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, hour, 0, 0, 0);
}

describe.skipIf(!hasDb)("takings are the orders settled that day", () => {
  let orgId: string;
  let db: (typeof import("../db"))["db"];
  let settledRevenueByDay: (typeof import("../services/revenue"))["settledRevenueByDay"];
  let settledRevenueByMonth: (typeof import("../services/revenue"))["settledRevenueByMonth"];
  let getBusinessHealth: (typeof import("../services/operationalIntelligence"))["getBusinessHealth"];

  beforeEach(async () => {
    ({ db } = await import("../db"));
    ({ settledRevenueByDay, settledRevenueByMonth } = await import("../services/revenue"));
    ({ getBusinessHealth } = await import("../services/operationalIntelligence"));

    orgId = randomUUID();
    await db.insert(organizations).values({ id: orgId, name: "Settled Revenue Test" });
  });

  afterEach(async () => {
    await db.delete(refunds).where(eq(refunds.orgId, orgId));
    await db.delete(orders).where(eq(orders.orgId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  /**
   * The production pattern this replaces. Arcarna is pick-and-pack, so orders
   * are routinely taken one day and handed over the next. The old aggregate
   * grouped by created_at, which booked the money against the day the request
   * arrived — every single day read wrong, and consistently one day early.
   */
  it("books an order taken Thursday and handed over Friday to Friday", async () => {
    await db.insert(orders).values({
      id: randomUUID(),
      orgId,
      total: "1743.50",
      paymentMethod: "cash",
      status: "completed",
      createdAt: at("2026-08-20"),
      settledTotal: "1743.50",
      settledAt: at("2026-08-21"),
    } as never);

    const byDay = await settledRevenueByDay(orgId, "2026-08-19", "2026-08-22");

    expect(byDay.get("2026-08-21")?.revenue).toBe(1743.5);
    expect(byDay.get("2026-08-21")?.txns).toBe(1);
    // The day it was taken must be empty — that is the whole defect.
    expect(byDay.get("2026-08-20")).toBeUndefined();
  });

  it("excludes pending and on-hold orders — they are open work, not money", async () => {
    await db.insert(orders).values([
      {
        id: randomUUID(),
        orgId,
        total: "59.00",
        paymentMethod: "cash",
        status: "pending",
        createdAt: at("2026-08-21"),
      },
      {
        id: randomUUID(),
        orgId,
        total: "60600.00",
        paymentMethod: "cash",
        status: "on-hold",
        createdAt: at("2026-08-21"),
      },
    ] as never);

    const byDay = await settledRevenueByDay(orgId, "2026-08-20", "2026-08-22");
    expect(byDay.size).toBe(0);
  });

  it("values a settled order at its frozen settlement total, not its live total", async () => {
    // A line price edited after settlement must not rewrite a past day.
    await db.insert(orders).values({
      id: randomUUID(),
      orgId,
      total: "999.00",
      paymentMethod: "cash",
      status: "completed",
      createdAt: at("2026-08-18"),
      settledTotal: "1152.50",
      settledAt: at("2026-08-19"),
    } as never);

    const byDay = await settledRevenueByDay(orgId, "2026-08-18", "2026-08-20");
    expect(byDay.get("2026-08-19")?.revenue).toBe(1152.5);
  });

  it("nets refunds off the day they were issued", async () => {
    const orderId = randomUUID();
    await db.insert(orders).values({
      id: orderId,
      orgId,
      total: "500.00",
      paymentMethod: "cash",
      status: "completed",
      createdAt: at("2026-08-19"),
      settledTotal: "500.00",
      settledAt: at("2026-08-19"),
    } as never);

    // Refunded two days later — it reduces the day it was issued, not the sale's day.
    await db.insert(refunds).values({
      id: randomUUID(),
      orderId,
      orgId,
      cashierId: "test-cashier",
      reason: "damaged",
      refundMethod: "cash",
      total: "120.00",
      createdAt: at("2026-08-21"),
    } as never);

    const byDay = await settledRevenueByDay(orgId, "2026-08-18", "2026-08-22");

    expect(byDay.get("2026-08-19")?.revenue).toBe(500);
    expect(byDay.get("2026-08-19")?.refundsTotal).toBe(0);
    expect(byDay.get("2026-08-21")?.revenue).toBe(-120);
    expect(byDay.get("2026-08-21")?.refundsTotal).toBe(120);
  });

  it("makes a month equal the sum of its days", async () => {
    await db.insert(orders).values([
      {
        id: randomUUID(),
        orgId,
        total: "100.00",
        paymentMethod: "cash",
        status: "completed",
        createdAt: at("2026-08-01"),
        settledTotal: "100.00",
        settledAt: at("2026-08-02"),
      },
      {
        id: randomUUID(),
        orgId,
        total: "250.00",
        paymentMethod: "cash",
        status: "completed",
        createdAt: at("2026-08-14"),
        settledTotal: "250.00",
        settledAt: at("2026-08-15"),
      },
    ] as never);

    const months = await settledRevenueByMonth(orgId, 1, at("2026-08-31"));
    const august = months.find((m) => m.year === 2026 && m.month === 8);

    expect(august?.revenue).toBe(350);
    expect(august?.txns).toBe(2);

    const byDay = await settledRevenueByDay(orgId, "2026-08-01", "2026-08-31");
    const summed = [...byDay.values()].reduce((s, d) => s + d.revenue, 0);
    expect(august?.revenue).toBe(Math.round(summed * 100) / 100);
  });

  it("business health includes today's settled takings and counts the same settled orders for AOV", async () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    await db.insert(orders).values([
      {
        id: randomUUID(),
        orgId,
        total: "200.00",
        paymentMethod: "cash",
        status: "completed",
        createdAt: today,
        settledTotal: "200.00",
        settledAt: today,
      },
      {
        id: randomUUID(),
        orgId,
        total: "999.00",
        paymentMethod: "cash",
        status: "pending",
        createdAt: today,
      },
    ] as never);

    const health = await getBusinessHealth(orgId);

    expect(health.revenueToday).toBe(200);
    expect(health.revenueRange).toBe(200);
    expect(health.orderCountToday).toBe(1);
    expect(health.orderCountRange).toBe(1);
    expect(health.averageOrderValue).toBe(200);
    expect(health.revenueTrend.at(-1)).toEqual({ date: todayKey, revenue: 200 });
  });
});
