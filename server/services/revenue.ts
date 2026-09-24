import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { orders, organizations, refunds } from "@shared/schema";
import type { DayKpi } from "@shared/analytics/kpi";
import { tradingDayBounds, tradingDayFor } from "@shared/time/tradingDay";

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
 * Optional scope for a revenue query — ARC-026. Omit either field for the
 * previous, org-wide behaviour (every existing caller does this; both are
 * purely additive).
 */
export interface RevenueScopeFilter {
  locationId?: string;
  /** A person's user id (auth subject), not a cashier code (STF-FN2). */
  staffUserId?: string;
}

/**
 * `orders`-table conditions for an optional location/person scope. The person
 * is read off `completed_user_id`: whoever took the order to completed.
 * Cashier codes are not used — no shift has carried one since the lazy-shift
 * change, so `completed_cashier_id` is NULL on current trading. Before
 * 27 Aug 2026 `completed_user_id` was backfilled by migration 057 from whoever
 * opened the shift, so older weeks are an inference, not a record.
 */
function scopeConditions(filter?: RevenueScopeFilter) {
  const extra = [];
  if (filter?.locationId) extra.push(eq(orders.locationId, filter.locationId));
  if (filter?.staffUserId) extra.push(eq(orders.completedUserId, filter.staffUserId));
  return extra;
}

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
  filter?: RevenueScopeFilter,
): Promise<Map<string, RevenueDay>> {
  // v1.2.1 money (M9): this used to bucket by UTC calendar date
  // (`date(settled_at)`), so a sale in the small hours landed on a different
  // day here (the Truths overview, the daily and monthly revenue charts) than
  // in Daily Sales, the Control Centre and the 06:00 close. Every figure now
  // uses the one trading day: 06:00 to 06:00 in the org's own timezone.
  const [org] = await db
    .select({ timezone: organizations.timezone })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return settledRevenueByTradingDay(orgId, org?.timezone || "Europe/London", fromDate, toDate, filter);
}

/**
 * Takings per TRADING day rather than calendar day — 06:00 to 06:00 in the
 * org's own timezone, the same cut the shift engine and the daily close use
 * (shared/time/tradingDay.ts).
 *
 * {@link settledRevenueByDay} stays calendar-bucketed on purpose: weekly and
 * monthly reports answer "how did this calendar week/month go", and nobody
 * disputes what that means. But a "today" figure sits right next to the till,
 * and the till's own day does not turn over at midnight — a sale at 1am is
 * still last night's shift, still on last night's Z-report, still the
 * previous day as far as commission and the 06:00 close are concerned. Bucket
 * "today's revenue" at midnight and it disagrees with every other number the
 * business already trusts about the same hour of trading.
 *
 * Same definition as {@link settledRevenueByDay} in every other respect —
 * settled status, settlement-snapshot value, refunds netted off the day
 * issued — just re-bucketed. Fetches the raw rows across the whole instant
 * range and buckets them in JS with {@link tradingDayFor}, because the 06:00
 * cut is DST-aware per organisation and cannot be expressed as a fixed SQL
 * offset without silently drifting an hour for the seven months a year the
 * clocks are forward.
 */
export async function settledRevenueByTradingDay(
  orgId: string,
  timeZone: string,
  fromTradingDay: string,
  toTradingDay: string,
  filter?: RevenueScopeFilter,
): Promise<Map<string, RevenueDay>> {
  const spanStart = tradingDayBounds(fromTradingDay, timeZone).start;
  const spanEnd = tradingDayBounds(toTradingDay, timeZone).end;

  const [settledRows, refundRows] = await Promise.all([
    db
      .select({
        settledAt: orders.settledAt,
        paymentMethod: orders.paymentMethod,
        gross: sql<string>`coalesce(${orders.settledTotal}, ${orders.total})::numeric`.as("gross"),
      })
      .from(orders)
      .where(
        and(
          eq(orders.orgId, orgId),
          eq(orders.status, SETTLED_STATUS),
          gte(orders.settledAt, spanStart),
          lt(orders.settledAt, spanEnd),
          ...scopeConditions(filter),
        ),
      ),

    // See settledRevenueByDay's identical join for why: refunds carry no
    // location/cashier of their own, so a scoped query nets off only the
    // refunds issued against that scope's own orders via the join.
    db
      .select({
        createdAt: refunds.createdAt,
        refunded: sql<string>`${refunds.total}::numeric`.as("refunded"),
      })
      .from(refunds)
      .innerJoin(orders, eq(refunds.orderId, orders.id))
      .where(
        and(
          eq(refunds.orgId, orgId),
          gte(refunds.createdAt, spanStart),
          lt(refunds.createdAt, spanEnd),
          ...scopeConditions(filter),
        ),
      ),
  ]);

  const byDay = new Map<string, RevenueDay>();
  const empty = (): RevenueDay => ({ revenue: 0, txns: 0, aov: 0, refundsTotal: 0 });

  for (const row of settledRows) {
    if (!row.settledAt) continue;
    const day = tradingDayFor(row.settledAt, timeZone);
    const existing = byDay.get(day) ?? empty();
    existing.revenue = round(existing.revenue + (Number(row.gross) || 0));
    // Personal use is a £0 order, not a sale: counting it would pull the
    // average order value down (v1.2.1 money, M13).
    if (String(row.paymentMethod ?? "").toLowerCase() !== "personal_use") existing.txns += 1;
    byDay.set(day, existing);
  }
  for (const [day, kpi] of byDay) {
    byDay.set(day, { ...kpi, aov: kpi.txns > 0 ? round(kpi.revenue / kpi.txns) : 0 });
  }

  // Refunds netted off the trading day they were issued, exactly as
  // settledRevenueByDay nets them off the calendar day issued — not
  // necessarily the trading day the original sale settled on.
  for (const row of refundRows) {
    if (!row.createdAt) continue;
    const day = tradingDayFor(row.createdAt, timeZone);
    const refunded = round(Number(row.refunded) || 0);
    if (refunded === 0) continue;
    const existing = byDay.get(day) ?? empty();
    existing.revenue = round(existing.revenue - refunded);
    existing.refundsTotal = round(existing.refundsTotal + refunded);
    byDay.set(day, existing);
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
