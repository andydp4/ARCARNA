/**
 * The 06:00 close.
 *
 * What has to hold: it totals the trading day that just finished, it closes the
 * shifts that traded it, it says something useful, and — the one that matters
 * most — running it twice does nothing the second time. A server restarted at
 * 06:00 must not total the day twice and send the Signals twice.
 *
 * Runs against a real database, so it is excluded from the no-DB run.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import {
  cashierShifts,
  dailyCloseRuns,
  orderPayments,
  orders,
  organizations,
  orgNotifications,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { closeTradingDay, runDueDailyCloses } from "../services/dailyClose";

const SUFFIX = Date.now().toString(36);
const LONDON = "Europe/London";
const DAY = "2026-02-10";
let orgId: string;

async function sale(
  total: number,
  method: string,
  at: string,
  opts: { status?: string; settledAt?: string | null; settledTotal?: number } = {},
) {
  const status = opts.status ?? "completed";
  const [order] = await db
    .insert(orders)
    .values({
      orgId,
      total: String(total),
      settledTotal: opts.settledTotal == null ? String(total) : String(opts.settledTotal),
      paymentMethod: method,
      status,
      createdAt: new Date(at),
      settledAt:
        opts.settledAt === null
          ? null
          : new Date(opts.settledAt ?? at),
    })
    .returning();
  await db
    .insert(orderPayments)
    .values({ orgId, orderId: order.id, method, amount: String(total) });
  return order.id;
}

async function signals() {
  return db
    .select()
    .from(orgNotifications)
    .where(and(eq(orgNotifications.orgId, orgId), eq(orgNotifications.source, "daily_close")));
}

beforeAll(async () => {
  const [org] = await db
    .insert(organizations)
    .values({ name: `daily-close-${SUFFIX}`, timezone: LONDON })
    .returning();
  orgId = org.id;

  // Two sales inside the trading day, one of them after midnight — which still
  // belongs to this day, because the cut is 06:00.
  await sale(100, "cash", "2026-02-10T14:00:00Z");
  await sale(60, "card", "2026-02-11T01:00:00Z");
  // Open work is not takings yet.
  await sale(800, "cash", "2026-02-10T15:00:00Z", { status: "pending", settledAt: null });
  // Created during this trading day, but settled after the 06:00 cut: this
  // belongs to the next day's figures.
  await sale(70, "cash", "2026-02-10T15:30:00Z", { settledAt: "2026-02-11T10:00:00Z" });
  // And one after the cut, which belongs to the next day and must not count.
  await sale(999, "cash", "2026-02-11T09:00:00Z");
});

afterAll(async () => {
  if (!orgId) return;
  await db.delete(orgNotifications).where(eq(orgNotifications.orgId, orgId));
  await db.delete(dailyCloseRuns).where(eq(dailyCloseRuns.orgId, orgId));
  await db.delete(orderPayments).where(eq(orderPayments.orgId, orgId));
  await db.delete(cashierShifts).where(eq(cashierShifts.orgId, orgId));
  await db.delete(orders).where(eq(orders.orgId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
});

describe("closing a trading day", () => {
  it("totals only what the day actually traded", async () => {
    const result = await closeTradingDay(orgId, DAY, LONDON);
    expect(result.alreadyRun).toBe(false);

    const [run] = await db
      .select()
      .from(dailyCloseRuns)
      .where(and(eq(dailyCloseRuns.orgId, orgId), eq(dailyCloseRuns.tradingDay, DAY)));

    // £100 + £60. The £999 sale is on the next trading day.
    expect(run.orderCount).toBe(2);
    expect(parseFloat(String(run.grossSales))).toBe(160);
    expect(parseFloat(String(run.cashSales))).toBe(100);
    expect(parseFloat(String(run.cardSales))).toBe(60);
  });

  it("says what the day did", async () => {
    const raised = await signals();
    const summary = raised.find((s) => s.title.startsWith("Trading day closed"));

    expect(summary).toBeDefined();
    expect(summary!.message).toContain("2 orders");
    expect(summary!.message).toContain("£160.00");
    expect(summary!.message).toContain("Cash £100.00");
  });

  it("does nothing at all the second time", async () => {
    // The case this exists for: a server restarted at 06:00.
    const before = (await signals()).length;

    const second = await closeTradingDay(orgId, DAY, LONDON);

    expect(second.alreadyRun).toBe(true);
    expect((await signals()).length).toBe(before);

    const runs = await db
      .select()
      .from(dailyCloseRuns)
      .where(and(eq(dailyCloseRuns.orgId, orgId), eq(dailyCloseRuns.tradingDay, DAY)));
    expect(runs).toHaveLength(1);
  });

  it("survives two closes racing each other", async () => {
    const raceDay = "2026-02-12";
    const results = await Promise.all([
      closeTradingDay(orgId, raceDay, LONDON),
      closeTradingDay(orgId, raceDay, LONDON),
      closeTradingDay(orgId, raceDay, LONDON),
    ]);

    expect(results.filter((r) => !r.alreadyRun)).toHaveLength(1);
    const runs = await db
      .select()
      .from(dailyCloseRuns)
      .where(and(eq(dailyCloseRuns.orgId, orgId), eq(dailyCloseRuns.tradingDay, raceDay)));
    expect(runs).toHaveLength(1);
  });

  it("closes the shifts that traded the day", async () => {
    const shiftDay = "2026-02-13";
    const [shift] = await db
      .insert(cashierShifts)
      .values({
        orgId,
        userId: `user-${SUFFIX}`,
        tradingDay: shiftDay,
        openedByUserId: `user-${SUFFIX}`,
        status: "open",
      })
      .returning();

    await closeTradingDay(orgId, shiftDay, LONDON);

    const [after] = await db.select().from(cashierShifts).where(eq(cashierShifts.id, shift.id));
    expect(after.status).not.toBe("open");
    expect(after.closedAt).not.toBeNull();
  });

  it("stays quiet on a day with no trading", async () => {
    const quietDay = "2026-02-14";
    const before = (await signals()).length;

    await closeTradingDay(orgId, quietDay, LONDON);

    // A row is still written, so the day is not reconsidered every fifteen
    // minutes forever — but nobody is told about a day nothing happened on.
    expect((await signals()).length).toBe(before);
    const runs = await db
      .select()
      .from(dailyCloseRuns)
      .where(and(eq(dailyCloseRuns.orgId, orgId), eq(dailyCloseRuns.tradingDay, quietDay)));
    expect(runs).toHaveLength(1);
  });
});

describe("catching up", () => {
  it("closes every missed day through the one that has just finished", async () => {
    // 06:05 on the 20th — the day that finished is the 19th.
    const results = await runDueDailyCloses(new Date("2026-02-20T06:05:00Z"));
    const mine = results.filter((r) => r.orgId === orgId).map((r) => r.tradingDay);

    expect(mine).toEqual([
      "2026-02-15",
      "2026-02-16",
      "2026-02-17",
      "2026-02-18",
      "2026-02-19",
    ]);
  });
});
