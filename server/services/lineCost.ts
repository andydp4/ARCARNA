import { sql } from "drizzle-orm";
import { orderItems, products } from "@shared/schema";

/**
 * The SQL twin of `lineUnitCost()` in shared/pricing/lineSnapshot.ts, for
 * COGS and Weekly Margin (PRC-06): a line's cost snapshot when it has one —
 * list_price set marks a snapshotted line, so a cost unknown at the time stays
 * unknown — otherwise the product's cost today, for lines sold before
 * snapshots existed. £0 or blank is unknown (usableCost rule). NULL = unknown.
 *
 * The query must join `products` (a LEFT join keeps lines whose product has
 * since been deleted; their snapshot still costs them).
 */
export const lineUnitCostSql = sql`(CASE WHEN ${orderItems.listPrice} IS NOT NULL
  THEN (CASE WHEN ${orderItems.unitCost} > 0 THEN ${orderItems.unitCost} END)
  ELSE (CASE WHEN ${products.costPrice} > 0 THEN ${products.costPrice} END) END)`;

/** quantity × unit cost for a line, NULL when the cost is unknown. */
export const lineCostSql = sql`(CAST(${orderItems.quantity} AS DECIMAL) * ${lineUnitCostSql})`;
