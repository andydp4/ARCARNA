/**
 * Delivery fee takings (v1.2.1): the part of takings that was delivery fees,
 * shown separately in the Truths and Evidence.
 *
 * Same definition as takings (server/services/revenue.ts): the fees on orders
 * SETTLED in the window, less the fees REFUNDED in it (refunds.delivery_fee,
 * migration 226). Valued as charged, VAT included, because takings are VAT
 * inclusive too. `orders` counts the window's settled sales that carried a fee.
 */
import { and, eq, gte, lt, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { orders, refunds } from "@shared/schema";

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
  const [back] = await db
    .select({ total: sql<string>`COALESCE(SUM(${refunds.deliveryFee}), 0)` })
    .from(refunds)
    .innerJoin(orders, eq(refunds.orderId, orders.id))
    .where(
      and(
        eq(refunds.orgId, orgId),
        gte(refunds.createdAt, start),
        lt(refunds.createdAt, end),
        ...scopeConds(filter),
      ),
    );
  return {
    total: round2((Number(row?.total) || 0) - (Number(back?.total) || 0)),
    orders: Number(row?.orders) || 0,
  };
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
  // Fees given back, on the day the refund was issued (as revenue.ts nets refunds).
  const backRows = await db
    .select({
      day: sql<string>`to_char(${refunds.createdAt}, 'YYYY-MM-DD')`,
      total: sql<string>`COALESCE(SUM(${refunds.deliveryFee}), 0)`,
    })
    .from(refunds)
    .where(
      and(
        eq(refunds.orgId, orgId),
        gte(sql`date(${refunds.createdAt})`, sql`${fromIso}::date`),
        lte(sql`date(${refunds.createdAt})`, sql`${toIso}::date`),
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
  for (const r of backRows) {
    const amount = round2(Number(r.total) || 0);
    if (amount === 0) continue;
    const day = String(r.day);
    byDate.set(day, round2((byDate.get(day) ?? 0) - amount));
    total -= amount;
  }
  return { total: round2(total), orders: count, byDate };
}
