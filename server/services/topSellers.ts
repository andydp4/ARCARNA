import { db } from "../db";
import { orderItems, orders } from "@shared/schema";
import { and, eq, gte, notInArray, sql } from "drizzle-orm";

/**
 * Orders that are not sales. A till sale lands as "pending" and only becomes
 * "completed" when it is collected, so counting completed alone would leave
 * today's takings out of the ranking. What is excluded is an order held for
 * review (oversold, may never go out) or one that was undone.
 *
 * "cancelled" is input tolerance, not a reachable state today: `orders.status`
 * is an untyped varchar, not the ORDER_STATUSES enum, and no current code path
 * writes 'cancelled' to it.
 */
const NOT_A_SALE = ["on-hold", "cancelled", "refunded", "voided"];

export type TopSellerRow = { productId: string; units: number };

/**
 * The products that go through the till most, by units, over a recent window.
 *
 * Feeds the one-tap chips on the order form. Ranked by units rather than
 * revenue because the chips exist to save taps, and the thing sold forty
 * times a day is the thing worth a tap whatever it costs. Counts every order
 * that is a sale, whatever stage it is at (see NOT_A_SALE).
 */
export async function topSellingProducts(
  orgId: string,
  opts: { days?: number; limit?: number; now?: Date } = {},
): Promise<TopSellerRow[]> {
  const days = Math.min(365, Math.max(1, Math.floor(opts.days ?? 30)));
  const limit = Math.min(50, Math.max(1, Math.floor(opts.limit ?? 12)));
  const since = new Date((opts.now ?? new Date()).getTime() - days * 86_400_000);

  const rows = await db
    .select({
      productId: orderItems.productId,
      units: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(
      and(
        eq(orderItems.orgId, orgId),
        eq(orders.orgId, orgId),
        notInArray(orders.status, NOT_A_SALE),
        gte(orders.createdAt, since),
      ),
    )
    .groupBy(orderItems.productId)
    .orderBy(sql`SUM(${orderItems.quantity}) DESC`)
    .limit(limit);

  return rows
    .filter((r): r is { productId: string; units: number } => !!r.productId)
    .map((r) => ({ productId: r.productId, units: Number(r.units) || 0 }));
}
