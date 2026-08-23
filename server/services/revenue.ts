import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { orders, refunds } from "@shared/schema";
import type { DayKpi } from "@shared/analytics/kpi";

/**
 * The single definition of "revenue taken" for Arcarna.
 *
 *   A day's takings are the orders SETTLED that day, valued at the settlement
 *   snapshot, less the refunds ISSUED that day.
 *
 * Every part of that sentence was previously got wrong somewhere, and each
 * mistake produced a different number for the same day:
 *
 * SETTLED, not created. Arcarna is pick-and-pack: a request arrives, it is
 * picked, then collected or delivered, and only then marked completed. Orders
 * routinely settle the day after they are taken. Aggregating by created_at
 * therefore books the money against the day the request arrived — so today
 * reads £0 until tomorrow, and yesterday's figure silently changes once the
 * picking is done. Live production orders showed this on every single day:
 * £1,152.50 booked to the 18th when it was taken on the 19th, £1,743.50 booked
 * to the 20th when it was taken on the 21st.
 *
 * SETTLED, not "all orders". The projection this replaces added the full total
 * on OrderCreated with no status test at all, so an order held back for
 * insufficient stock counted as money in the till. Pending and on-hold orders
 * are open work — they belong in Open Orders, never in the figures.
 *
 * At the SETTLEMENT SNAPSHOT, not orders.total. settled_total is frozen the
 * first time an order completes (migration 044) precisely because line prices
 * can be edited afterwards, and refunds cap against it. Valuing takings at the
 * live total would let an edit to an old order rewrite a past day's revenue.
 * COALESCE covers rows settled before that column existed.
 *
 * LESS REFUNDS ISSUED THAT DAY. Refunds are rows in `refunds` with a positive
 * total, not negative-total orders — the code this replaces looked for negative
 * orders, a shape this system has never produced, so refunds were simply never
 * subtracted.
 *
 * Computed from `orders` directly rather than from an analytics_daily
 * projection. The projection was event-sourced with `+=` and never reconciled,
 * so it drifted from reality with nothing to notice; one org sat three orders
 * adrift. At tens of orders a day the aggregate is cheap, and the route layer
 * already caches it.
 */
const SETTLED_STATUS = "completed";

export type RevenueDay = DayKpi;

/**
 * Takings per day between `fromDate` and `toDate` inclusive (ISO yyyy-mm-dd).
 *
 * Days inside the range with no activity are present with zeroes — a quiet day
 * is a real zero, not missing data. Callers that need to tell "we took nothing"
 * apart from "we were not trading yet" should use {@link firstSettledDate}.
 */
export async function settledRevenueByDay(
  orgId: string,
  fromDate: string,
  toDate: string,
): Promise<Map<string, RevenueDay>> {
  const [settledRows, refundRows] = await Promise.all([
    db
      .select({
        day: sql<string>`to_char(${orders.settledAt}, 'YYYY-MM-DD')`.as("day"),
        gross: sql<string>`coalesce(sum(coalesce(${orders.settledTotal}, ${orders.total})::numeric), 0)`.as("gross"),
        txns: sql<number>`count(*)::int`.as("txns"),
      })
      .from(orders)
      .where(
        and(
          eq(orders.orgId, orgId),
          eq(orders.status, SETTLED_STATUS),
          gte(sql`date(${orders.settledAt})`, sql`${fromDate}::date`),
          lte(sql`date(${orders.settledAt})`, sql`${toDate}::date`),
        ),
      )
      .groupBy(sql`1`),

    db
      .select({
        day: sql<string>`to_char(${refunds.createdAt}, 'YYYY-MM-DD')`.as("day"),
        refunded: sql<string>`coalesce(sum(${refunds.total}::numeric), 0)`.as("refunded"),
      })
      .from(refunds)
      .where(
        and(
          eq(refunds.orgId, orgId),
          gte(sql`date(${refunds.createdAt})`, sql`${fromDate}::date`),
          lte(sql`date(${refunds.createdAt})`, sql`${toDate}::date`),
        ),
      )
      .groupBy(sql`1`),
  ]);

  const byDay = new Map<string, RevenueDay>();

  for (const row of settledRows) {
    const gross = round(Number(row.gross) || 0);
    const txns = row.txns ?? 0;
    byDay.set(String(row.day), {
      revenue: gross,
      txns,
      aov: txns > 0 ? round(gross / txns) : 0,
      refundsTotal: 0,
    });
  }

  // Refunds are netted off the day they were issued, which is not necessarily
  // the day the order settled — a refund on Friday against Monday's sale
  // reduces Friday. AOV stays on gross takings so it keeps meaning "typical
  // order size" rather than moving because someone was refunded.
  for (const row of refundRows) {
    const day = String(row.day);
    const refunded = round(Number(row.refunded) || 0);
    if (refunded === 0) continue;
    const existing = byDay.get(day) ?? { revenue: 0, txns: 0, aov: 0, refundsTotal: 0 };
    byDay.set(day, {
      ...existing,
      revenue: round(existing.revenue - refunded),
      refundsTotal: round(existing.refundsTotal + refunded),
    });
  }

  return byDay;
}

/**
 * The org's earliest settlement, or null if it has never settled an order.
 *
 * Comparisons look back a year. Without this, a day before the org was trading
 * is indistinguishable from a day it traded and took nothing, so a business two
 * months old would have its year-on-year average dragged toward zero by ten
 * months of dates that never existed.
 */
export async function firstSettledDate(orgId: string): Promise<string | null> {
  const [row] = await db
    .select({ day: sql<string | null>`to_char(min(${orders.settledAt}), 'YYYY-MM-DD')` })
    .from(orders)
    .where(and(eq(orders.orgId, orgId), eq(orders.status, SETTLED_STATUS)));
  return row?.day ?? null;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export type RevenueMonth = {
  year: number;
  month: number;
  revenue: number;
  txns: number;
};

/**
 * Takings per calendar month, ending with the month containing `today`.
 *
 * Deliberately a roll-up of {@link settledRevenueByDay} rather than its own
 * aggregate. A separate monthly query would be a second place for the
 * definition to live, and the two would eventually disagree — which is exactly
 * what happened when analytics_daily and analytics_monthly were both
 * accumulated independently from the same events. Summing the days makes the
 * month equal to its days by construction.
 */
export async function settledRevenueByMonth(
  orgId: string,
  months: number,
  today: Date = new Date(),
): Promise<RevenueMonth[]> {
  const endYear = today.getFullYear();
  const endMonth = today.getMonth(); // 0-based

  const startAnchor = new Date(endYear, endMonth - (months - 1), 1);
  const endAnchor = new Date(endYear, endMonth + 1, 0); // last day of the end month

  const byDay = await settledRevenueByDay(orgId, iso(startAnchor), iso(endAnchor));

  const buckets = new Map<string, RevenueMonth>();
  for (let i = 0; i < months; i++) {
    const anchor = new Date(endYear, endMonth - (months - 1) + i, 1);
    buckets.set(`${anchor.getFullYear()}-${anchor.getMonth() + 1}`, {
      year: anchor.getFullYear(),
      month: anchor.getMonth() + 1,
      revenue: 0,
      txns: 0,
    });
  }

  for (const [day, kpi] of byDay) {
    const [y, m] = day.split("-").map(Number);
    const bucket = buckets.get(`${y}-${m}`);
    if (!bucket) continue;
    bucket.revenue = round(bucket.revenue + kpi.revenue);
    bucket.txns += kpi.txns;
  }

  return [...buckets.values()];
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
