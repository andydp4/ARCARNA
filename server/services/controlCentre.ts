/**
 * The Control Centre's single data source.
 *
 * Deliberately separate from {@link getBusinessHealth} in operationalIntelligence.ts
 * rather than a rewrite of it: that function's exact shape is depended on by
 * scheduled report emails and the assistant's summary alerts, neither of which
 * this page should risk. This is the one place that answers "how is today
 * going", and it answers with the trading day — 06:00 to 06:00 in the org's
 * own timezone, the same day the shift engine, the Z-report and the 06:00
 * close already use (shared/time/tradingDay.ts).
 *
 * The dashboard this replaces answered that question three different ways in
 * three different cards: revenue bucketed by calendar day at the database's
 * timezone, an order count bucketed by calendar day at the server process's
 * timezone, and a "completed today" count filtered by CREATION date rather
 * than completion. None of the three agreed with each other, and none of them
 * agreed with the shift the till was actually running.
 */
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import {
  orders,
  customers,
  orderCredit,
  dailyCloseRuns,
  userApprovalRequests,
  deadLetters,
} from "@shared/schema";
import {
  currentTradingDay,
  lastClosedTradingDay,
  shiftIsoDate,
  tradingDayBounds,
} from "@shared/time/tradingDay";
import {
  averageSameWeekdayKpi,
  offsetDate,
  sameWeekdayWindow,
  type DayKpi,
} from "@shared/analytics/kpi";
import { settledRevenueByTradingDay } from "./revenue";
import { getSmartStock } from "./operationalIntelligence";
import { getJobQueueStats } from "../eventBus";
import { orgTimeZone } from "./tradingDayShift";

export type NextMoveSeverity = "info" | "warning" | "error";

export type NextMove = {
  id: string;
  message: string;
  severity: NextMoveSeverity;
  href: string;
};

export type ControlCentreSnapshot = {
  timezone: string;
  tradingDay: string;
  now: string;

  today: DayKpi;
  vsLastWeek: DayKpi | null;
  vsSameWeekdayAvg: DayKpi | null;
  revenueTrend: { date: string; revenue: number }[];

  ordersCreatedToday: number;
  ordersCompletedToday: number;
  openOrders: number;
  toCollect: number;
  toDeliver: number;

  lowStockCount: number;
  highRiskStockCount: number;
  deadStockCount: number;
  negativeStockCount: number;
  topProduct: { name: string; unitsSold: number } | null;

  creditOutstandingTotal: number;
  creditCustomersCount: number;
  newCustomers7d: number;

  workerHealth: { status: string; queued: number; failed: number; deadLetter: number };
  pendingApprovals: number;

  yesterdayTradingDay: string;
  yesterdayCloseRan: boolean;

  nextMoves: NextMove[];
};

const SETTLED_STATUS = "completed";
const TREND_DAYS = 7;

export async function getControlCentreSnapshot(
  orgId: string,
  now: Date = new Date(),
): Promise<ControlCentreSnapshot> {
  const timezone = await orgTimeZone(orgId);
  const tradingDay = currentTradingDay(timezone, now);
  const yesterdayTradingDay = lastClosedTradingDay(timezone, now);
  const lastWeekDay = offsetDate(tradingDay, -7);
  const ltmDates = sameWeekdayWindow(tradingDay, 52);
  const trendStart = shiftIsoDate(tradingDay, -(TREND_DAYS - 1));

  const allDates = [tradingDay, lastWeekDay, trendStart, ...ltmDates];
  const minDate = allDates.reduce((min, d) => (d < min ? d : min), allDates[0]);
  const maxDate = allDates.reduce((max, d) => (d > max ? d : max), allDates[0]);

  const byDay = await settledRevenueByTradingDay(orgId, timezone, minDate, maxDate);
  const emptyDay = (): DayKpi => ({ revenue: 0, txns: 0, aov: 0, refundsTotal: 0 });
  const today = byDay.get(tradingDay) ?? emptyDay();
  const vsLastWeek = byDay.get(lastWeekDay) ?? null;
  const vsSameWeekdayAvg = averageSameWeekdayKpi(ltmDates.map((d) => byDay.get(d) ?? null));

  const revenueTrend: { date: string; revenue: number }[] = [];
  for (let d = trendStart; d <= tradingDay; d = shiftIsoDate(d, 1)) {
    revenueTrend.push({ date: d, revenue: byDay.get(d)?.revenue ?? 0 });
  }

  const bounds = tradingDayBounds(tradingDay, timezone);

  const [
    createdTodayRow,
    completedTodayRow,
    openOrdersRow,
    creditRow,
    newCustomersRow,
    approvalsRow,
    closeRunRow,
    deadLetterRows,
    jobStats,
    smart,
    productsWithStock,
  ] = await Promise.all([
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(eq(orders.orgId, orgId), gte(orders.createdAt, bounds.start), lt(orders.createdAt, bounds.end))),

    // Completed TODAY means settled within today's trading day — not created
    // today. Arcarna is pick-and-pack; an order taken last night and handed
    // over this morning is a completion today even though it was created
    // yesterday's trading day, and the old "Completed today" tile missed
    // exactly that case by filtering on created_at.
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(orders)
      .where(
        and(
          eq(orders.orgId, orgId),
          eq(orders.status, SETTLED_STATUS),
          gte(orders.settledAt, bounds.start),
          lt(orders.settledAt, bounds.end),
        ),
      ),

    // Open work is open regardless of which day it was created — no date
    // filter here is deliberate, matching Open Orders itself.
    db
      .select({
        c: sql<number>`count(*)::int`,
        toDeliver: sql<number>`count(*) filter (where ${orders.fulfilmentMethod} = 'delivery')::int`,
      })
      .from(orders)
      .where(and(eq(orders.orgId, orgId), sql`${orders.status} != ${SETTLED_STATUS}`)),

    db
      .select({
        total: sql<string>`coalesce(sum(${orderCredit.amountOutstanding}::numeric), 0)`,
        customers: sql<number>`count(distinct ${orderCredit.customerId}) filter (where ${orderCredit.customerId} is not null)::int`,
      })
      .from(orderCredit)
      .where(and(eq(orderCredit.orgId, orgId), sql`${orderCredit.status} in ('outstanding', 'partial')`)),

    db
      .select({ c: sql<number>`count(*)::int` })
      .from(customers)
      .where(and(eq(customers.orgId, orgId), gte(customers.createdAt, tradingDayStartInstant(trendStart, timezone)))),

    db
      .select({ c: sql<number>`count(*)::int` })
      .from(userApprovalRequests)
      .where(eq(userApprovalRequests.status, "pending")),

    db
      .select({ tradingDay: dailyCloseRuns.tradingDay })
      .from(dailyCloseRuns)
      .where(and(eq(dailyCloseRuns.orgId, orgId), eq(dailyCloseRuns.tradingDay, yesterdayTradingDay)))
      .limit(1),

    // Unscoped, matching operationalIntelligence.ts's own dead-letter count:
    // dead_letters carries no org_id at all — a failed background job is a
    // system-wide concern, not one org's problem, since the worker that
    // failed was processing an event that may not map cleanly to one org.
    db.select().from(deadLetters).orderBy(desc(deadLetters.failedAt)).limit(5),

    getJobQueueStats(),

    getSmartStock(orgId, 30).catch(() => null),

    // The simple percentage-threshold model /api/inventory/alerts already
    // uses for "Low stock" — deliberately not getSmartStock's velocity-based
    // risk model below, which answers a related but different question and
    // has always been reported separately as "high-risk stock".
    storage.getProductsWithStock(orgId).catch(() => [] as Awaited<ReturnType<typeof storage.getProductsWithStock>>),
  ]);

  // Same shape as /api/inventory/alerts: at or under the stock limit, and
  // within 30% of it. Kept separate from getSmartStock's velocity-based risk
  // model above — the two have always answered different questions and been
  // shown as two different tiles.
  const lowStockCount = productsWithStock.filter((p) => {
    if (p.stock == null || p.stockLimit == null || p.stockLimit === 0) return false;
    const pct = (p.stock / p.stockLimit) * 100;
    return p.stock <= p.stockLimit && pct <= 30;
  }).length;

  const workerHealth = {
    queued: jobStats.queued,
    failed: jobStats.failed,
    deadLetter: jobStats.deadLetter,
    status:
      jobStats.deadLetter > 0 || jobStats.failed > 5
        ? "degraded"
        : jobStats.queued > 50
          ? "busy"
          : "healthy",
  };

  const pendingApprovals = approvalsRow[0]?.c ?? 0;
  const creditOutstandingTotal = Math.round((Number(creditRow[0]?.total) || 0) * 100) / 100;
  const creditCustomersCount = creditRow[0]?.customers ?? 0;

  // A grace window past the 06:00 cut before flagging yesterday's close as
  // missing — the worker that runs it fires on a poll, not the instant the
  // clock strikes six, and a dashboard that cries wolf for the first few
  // minutes of every trading day teaches people to ignore the signal for the
  // day it actually matters.
  const CLOSE_GRACE_MS = 20 * 60 * 1000;
  const msIntoTradingDay = now.getTime() - bounds.start.getTime();
  const yesterdayCloseRan =
    closeRunRow.length > 0 || msIntoTradingDay < CLOSE_GRACE_MS;

  const nextMoves: NextMove[] = [];
  if (deadLetterRows.length > 0) {
    nextMoves.push({
      id: "worker-dead-letter",
      message: `${deadLetterRows.length} background job(s) failed permanently and need a look.`,
      severity: "error",
      href: "/worker-logs",
    });
  }
  if (!yesterdayCloseRan) {
    nextMoves.push({
      id: "close-missing",
      message: `The close for ${yesterdayTradingDay} hasn't run yet.`,
      severity: "error",
      href: "/shifts",
    });
  }
  if (smart && smart.summary.negativeStockCount > 0) {
    nextMoves.push({
      id: "stock-negative",
      message: `${smart.summary.negativeStockCount} product(s) show negative stock.`,
      severity: "warning",
      href: "/inventory",
    });
  }
  if (creditOutstandingTotal > 0) {
    nextMoves.push({
      id: "credit-outstanding",
      message: `£${creditOutstandingTotal.toFixed(2)} outstanding on credit across ${creditCustomersCount} customer(s).`,
      severity: "warning",
      href: "/tick-list",
    });
  }
  if (smart && smart.summary.highRiskCount > 0) {
    nextMoves.push({
      id: "stock-high-risk",
      message: `${smart.summary.highRiskCount} stock item(s) need attention before they run out.`,
      severity: "warning",
      href: "/inventory",
    });
  }
  if (pendingApprovals > 0) {
    nextMoves.push({
      id: "approvals-pending",
      message: `${pendingApprovals} user(s) awaiting approval.`,
      severity: "info",
      href: "/user-access",
    });
  }

  const severityRank: Record<NextMoveSeverity, number> = { error: 0, warning: 1, info: 2 };
  nextMoves.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  return {
    timezone,
    tradingDay,
    now: now.toISOString(),

    today,
    vsLastWeek,
    vsSameWeekdayAvg,
    revenueTrend,

    ordersCreatedToday: createdTodayRow[0]?.c ?? 0,
    ordersCompletedToday: completedTodayRow[0]?.c ?? 0,
    openOrders: openOrdersRow[0]?.c ?? 0,
    toDeliver: openOrdersRow[0]?.toDeliver ?? 0,
    toCollect: (openOrdersRow[0]?.c ?? 0) - (openOrdersRow[0]?.toDeliver ?? 0),

    lowStockCount,
    highRiskStockCount: smart?.summary.highRiskCount ?? 0,
    deadStockCount: smart?.summary.deadStockCount ?? 0,
    negativeStockCount: smart?.summary.negativeStockCount ?? 0,
    topProduct: smart?.summary.bestSellers[0]
      ? { name: smart.summary.bestSellers[0].name, unitsSold: smart.summary.bestSellers[0].unitsSold }
      : null,

    creditOutstandingTotal,
    creditCustomersCount,
    newCustomers7d: newCustomersRow[0]?.c ?? 0,

    workerHealth,
    pendingApprovals,

    yesterdayTradingDay,
    yesterdayCloseRan,

    nextMoves: nextMoves.slice(0, 4),
  };
}

/** The instant a trading day's ISO date starts, for use as a plain lower bound. */
function tradingDayStartInstant(isoDate: string, timezone: string): Date {
  return tradingDayBounds(isoDate, timezone).start;
}
