import { db } from "../db";
import { analyticsDaily, orders } from "@shared/schema";
import {
  aggregateDay,
  aggregateFromDailyRow,
  averageSameWeekdayKpi,
  offsetDate,
  sameWeekdayWindow,
  type DailyKpiResponse,
  type DayKpi,
} from "@shared/analytics/kpi";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";

const COMPLETED_STATUS = "completed";
const LIVE_LOOKBACK_DAYS = 60;

export async function getDailyKpi(orgId: string, date: string): Promise<DailyKpiResponse> {
  const lastWeekDate = offsetDate(date, -7);
  const ltmDates = sameWeekdayWindow(date, 52);
  const allDates = [date, lastWeekDate, ...ltmDates];
  const liveCutoff = offsetDate(date, -LIVE_LOOKBACK_DAYS);

  const dailyRows = await db
    .select({
      date: analyticsDaily.date,
      totalOrders: analyticsDaily.totalOrders,
      totalRevenue: analyticsDaily.totalRevenue,
    })
    .from(analyticsDaily)
    .where(and(eq(analyticsDaily.orgId, orgId), inArray(analyticsDaily.date, allDates)));

  const dailyByDate = new Map<string, DayKpi | null>(
    dailyRows.map((row) => [String(row.date), aggregateFromDailyRow(row)]),
  );

  const missingDates = allDates.filter((d) => !dailyByDate.has(d));
  const liveEligible = missingDates.filter((d) => d >= liveCutoff);

  if (liveEligible.length > 0) {
    const liveByDate = await aggregateOrdersLive(
      orgId,
      liveEligible.reduce((min, d) => (d < min ? d : min), liveEligible[0]),
      liveEligible.reduce((max, d) => (d > max ? d : max), liveEligible[0]),
    );
    for (const d of liveEligible) {
      dailyByDate.set(d, liveByDate.get(d) ?? emptyDay());
    }
  }

  for (const d of missingDates.filter((d) => d < liveCutoff)) {
    dailyByDate.set(d, null);
  }

  const today = dailyByDate.get(date) ?? emptyDay();
  const lastWeek = dailyByDate.get(lastWeekDate) ?? emptyDay();
  const ltmValues = ltmDates.map((d) => dailyByDate.get(d) ?? null);
  const sameWeekdayLtmAvg = averageSameWeekdayKpi(ltmValues);

  return { today, lastWeek, sameWeekdayLtmAvg, date };
}

async function aggregateOrdersLive(
  orgId: string,
  minDate: string,
  maxDate: string,
): Promise<Map<string, DayKpi>> {
  const minStart = parseDateStart(minDate);
  const maxEnd = parseDateEnd(maxDate);

  const rows = await db
    .select({
      day: sql<string>`DATE(${orders.createdAt})`.as("day"),
      total: orders.total,
      status: orders.status,
    })
    .from(orders)
    .where(
      and(
        eq(orders.orgId, orgId),
        gte(orders.createdAt, minStart),
        lte(orders.createdAt, maxEnd),
      ),
    );

  const grouped = new Map<string, { total: number | string; isRefund?: boolean }[]>();

  for (const row of rows) {
    const day = String(row.day);
    const list = grouped.get(day) ?? [];
    const amount = Number(row.total) || 0;
    const isRefund = amount < 0;
    const isCompleted = row.status === COMPLETED_STATUS;
    if (isRefund) {
      list.push({ total: amount, isRefund: true });
    } else if (isCompleted) {
      list.push({ total: amount });
    }
    grouped.set(day, list);
  }

  const byDay = new Map<string, DayKpi>();
  for (const [day, dayOrders] of grouped) {
    byDay.set(day, aggregateDay(dayOrders));
  }

  return byDay;
}

function emptyDay(): DayKpi {
  return { revenue: 0, txns: 0, aov: 0, refundsTotal: 0 };
}

function parseDateStart(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function parseDateEnd(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}
