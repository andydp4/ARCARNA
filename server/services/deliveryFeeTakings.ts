/**
 * Delivery fee takings (v1.2.1): the part of takings that was delivery fees,
 * shown separately in the Truths and Evidence.
 *
 * Same definition as takings (server/services/revenue.ts): orders SETTLED in
 * the window. Valued as charged, VAT included, because takings are VAT
 * inclusive too. A refund is not split between goods and fee (a refund row
 * records only an amount), so this is the fees charged on the window's
 * settled sales, before refunds, and the Evidence says so.
 */
import { and, eq, gte, lt, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { orders } from "@shared/schema";

export type DeliveryFeeTakings = { total: number; orders: number };

/** The fee as charged: the fee plus the VAT on it at the order's own rate. */
const feeChargedSql = sql`ROUND(COALESCE(${orders.deliveryFee}, 0) * (1 + COALESCE(${orders.vatRate}, 0) / 100), 2)`;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type Scope = { locationId?: string; staffUserId?: string };

function scopeConds(filter?: Scope) {
  const conds = [];
  if (filter?.locationId) conds.push(eq(orders.locationId, filter.locationId));
  if (filter?.staffUserId) conds.push(eq(orders.completedUserId, filter.staffUserId));
  return conds;
}

/** Fees on orders settled in `[start, end)` (a trading-day window). */
export async function deliveryFeeTakingsBetween(
  orgId: string,
  start: Date,
  end: Date,
  filter?: Scope,
): Promise<DeliveryFeeTakings> {
  const [row] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${feeChargedSql}), 0)`,
      orders: sql<number>`COUNT(*) FILTER (WHERE COALESCE(${orders.deliveryFee}, 0) > 0)::int`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.orgId, orgId),
        eq(orders.status, "completed"),
        gte(orders.settledAt, start),
        lt(orders.settledAt, end),
        ...scopeConds(filter),
      ),
    );
  return { total: round2(Number(row?.total) || 0), orders: Number(row?.orders) || 0 };
}

/**
 * Fees per settled calendar date between two ISO dates inclusive, the same
 * `date(settled_at)` buckets as settledRevenueByDay() (the Truths hub and
 * Profit Truths).
 */
export async function deliveryFeeTakingsByDate(
  orgId: string,
  fromIso: string,
  toIso: string,
): Promise<{ total: number; orders: number; byDate: Map<string, number> }> {
  const rows = await db
    .select({
      day: sql<string>`to_char(${orders.settledAt}, 'YYYY-MM-DD')`,
      total: sql<string>`COALESCE(SUM(${feeChargedSql}), 0)`,
      orders: sql<number>`COUNT(*) FILTER (WHERE COALESCE(${orders.deliveryFee}, 0) > 0)::int`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.orgId, orgId),
        eq(orders.status, "completed"),
        gte(sql`date(${orders.settledAt})`, sql`${fromIso}::date`),
        lte(sql`date(${orders.settledAt})`, sql`${toIso}::date`),
      ),
    )
    .groupBy(sql`1`);
  const byDate = new Map<string, number>();
  let total = 0;
  let count = 0;
  for (const r of rows) {
    const amount = round2(Number(r.total) || 0);
    byDate.set(String(r.day), amount);
    total += amount;
    count += Number(r.orders) || 0;
  }
  return { total: round2(total), orders: count, byDate };
}
