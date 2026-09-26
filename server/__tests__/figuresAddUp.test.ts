/**
 * v1.2.1 money audit: the Truths figures add up.
 *
 *  - M6: Daily Sales' tender rows must add up to the day's total. They used to
 *    net each refund against the original sale's day and tender, so a closed
 *    day's split changed when a later refund happened, and the rows of the
 *    day the refund was made did not add up.
 *  - M13: personal use is not a sale, so it is not an order processed and
 *    does not pull the average order value down.
 *  - M9: the Truths overview and the revenue charts (settledRevenueByDay) put
 *    a small-hours sale on the same trading day as Daily Sales and the close,
 *    not on its UTC calendar date.
 *  - M7: Weekly Margin counts what was really sold and paid for: no personal
 *    use, refunded units taken back off, and a sale's discount shared across
 *    its lines.
 *
 * Mid-September dates, so Europe/London is on BST (UTC+1).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { orderItems, orderPayments, orders, organizations, products, refundLines, refunds } from "@shared/schema";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("Truths figures add up", () => {
  let orgId: string;
  let db: (typeof import("../db"))["db"];
  let reports: typeof import("../services/reportsEngine");
  let revenue: typeof import("../services/revenue");

  async function sale(opts: {
    total: number;
    method: string;
    at: string;
    legs?: Array<[string, number]>;
    lines?: Array<{ productId: string; qty: number; unit: number }>;
  }): Promise<{ id: string; lineIds: string[] }> {
    const id = randomUUID();
    await db.insert(orders).values({
      id,
      orgId,
      total: opts.total.toFixed(2),
      settledTotal: opts.total.toFixed(2),
      paymentMethod: opts.method,
      status: "completed",
      createdAt: new Date(opts.at),
      settledAt: new Date(opts.at),
    } as never);
    for (const [method, amount] of opts.legs ?? [[opts.method, opts.total]]) {
      await db.insert(orderPayments).values({ orgId, orderId: id, method, amount: amount.toFixed(2) });
    }
    const lineIds: string[] = [];
    for (const l of opts.lines ?? []) {
      const [row] = await db
        .insert(orderItems)
        .values({
          orgId,
          orderId: id,
          productId: l.productId,
          quantity: l.qty,
          unitPrice: l.unit.toFixed(2),
          totalPrice: (l.qty * l.unit).toFixed(2),
          listPrice: l.unit.toFixed(2),
          unitCost: "10.00",
        } as never)
        .returning();
      lineIds.push(row.id);
    }
    return { id, lineIds };
  }

  async function refund(orderId: string, total: number, method: string, at: string, line?: { id: string; qty: number }) {
    const [r] = await db
      .insert(refunds)
      .values({ orderId, orgId, cashierId: "u", reason: "damaged", refundMethod: method, total: total.toFixed(2), createdAt: new Date(at) })
      .returning();
    if (line) await db.insert(refundLines).values({ refundId: r.id, orderLineId: line.id, qty: line.qty, amount: total.toFixed(2) });
  }

  beforeEach(async () => {
    ({ db } = await import("../db"));
    reports = await import("../services/reportsEngine");
    revenue = await import("../services/revenue");
    orgId = randomUUID();
    await db.insert(organizations).values({ id: orgId, name: "Figures Add Up Test", timezone: "Europe/London" } as never);
  });

  afterEach(async () => {
    const ids = (await db.select({ id: orders.id }).from(orders).where(eq(orders.orgId, orgId))).map((o) => o.id);
    if (ids.length) {
      const rIds = (await db.select({ id: refunds.id }).from(refunds).where(inArray(refunds.orderId, ids))).map((r) => r.id);
      if (rIds.length) await db.delete(refundLines).where(inArray(refundLines.refundId, rIds));
      await db.delete(refunds).where(eq(refunds.orgId, orgId));
      await db.delete(orderPayments).where(eq(orderPayments.orgId, orgId));
      await db.delete(orderItems).where(eq(orderItems.orgId, orgId));
      await db.delete(orders).where(eq(orders.orgId, orgId));
    }
    await db.delete(products).where(eq(products.orgId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  const rowsSum = (report: any) => Math.round(report.rows.reduce((s: number, r: any) => s + r.revenue, 0) * 100) / 100;

  it("M6: each day's tender rows add up to its total, and a later refund leaves the earlier day's split alone", async () => {
    // 17 Sept: £30 cash and £80 card. 18 Sept: £50 card, and the 17th's cash sale refunded in cash.
    const cash = await sale({ total: 30, method: "cash", at: "2026-09-17T10:00:00.000Z" });
    await sale({ total: 80, method: "card", at: "2026-09-17T11:00:00.000Z" });
    await sale({ total: 50, method: "card", at: "2026-09-18T10:00:00.000Z" });
    await refund(cash.id, 30, "original", "2026-09-18T12:00:00.000Z");

    const d17 = await reports.dailySalesSummary(orgId, new Date("2026-09-17T00:00:00.000Z"));
    const d18 = await reports.dailySalesSummary(orgId, new Date("2026-09-18T00:00:00.000Z"));
    expect(d17.summary.totalRevenue).toBe(110);
    expect(rowsSum(d17)).toBe(110);
    expect(d17.summary.cashRevenue).toBe(30);
    expect(d18.summary.totalRevenue).toBe(20);
    expect(rowsSum(d18)).toBe(20);
    expect(d18.summary.cashRevenue).toBe(-30);
    expect(d18.summary.cardRevenue).toBe(50);
  });

  it("M13: personal use is not an order processed", async () => {
    await sale({ total: 30, method: "cash", at: "2026-09-12T10:00:00.000Z" });
    await sale({ total: 20, method: "card", at: "2026-09-12T11:00:00.000Z" });
    await sale({ total: 0, method: "personal_use", at: "2026-09-12T12:00:00.000Z" });
    const d = await reports.dailySalesSummary(orgId, new Date("2026-09-12T00:00:00.000Z"));
    expect(d.summary.ordersProcessed).toBe(2);
    expect(d.summary.avgOrderValue).toBe(25);
  });

  it("M9: the Truths overview puts a small-hours sale on its trading day", async () => {
    // 02:00 BST on the 24th (01:00 UTC): still the 23rd's trading day.
    await sale({ total: 10, method: "cash", at: "2026-09-24T01:00:00.000Z" });
    const byDay = await revenue.settledRevenueByDay(orgId, "2026-09-23", "2026-09-24");
    expect(byDay.get("2026-09-23")?.revenue).toBe(10);
    expect(byDay.get("2026-09-24")?.revenue ?? 0).toBe(0);
  });

  it("M7: Weekly Margin leaves out personal use and refunded units, and honours the sale's discount", async () => {
    const [gadget] = await db
      .insert(products)
      .values({ orgId, name: "Gadget", productId: `g-${randomUUID().slice(0, 6)}`, defaultSalePrice: "25.00", costPrice: "10.00" } as never)
      .returning();
    // 2 x £25 with 10% off, settled at £45; one refunded (£22.50).
    const promo = await sale({ total: 45, method: "card", at: "2026-09-10T10:00:00.000Z", lines: [{ productId: gadget.id, qty: 2, unit: 25 }] });
    await refund(promo.id, 22.5, "card", "2026-09-11T10:00:00.000Z", { id: promo.lineIds[0], qty: 1 });
    // 2 taken for personal use: not sold.
    await sale({ total: 0, method: "personal_use", at: "2026-09-10T11:00:00.000Z", lines: [{ productId: gadget.id, qty: 2, unit: 25 }] });

    const r = await reports.weeklyMarginSummary(orgId, new Date("2026-09-09T00:00:00.000Z"), new Date("2026-09-15T00:00:00.000Z"));
    const row = (r.rows as any[]).find((x) => x.product === "Gadget");
    expect(row.unitsSold).toBe(1);
    expect(row.avgSellPrice).toBeCloseTo(22.5, 2);
    expect(row.totalMargin).toBeCloseTo(12.5, 2);
  });
});
