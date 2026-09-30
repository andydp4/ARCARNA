import { and, eq, sql, type SQL } from "drizzle-orm";
import { orderItems, orders, products } from "@shared/schema";
import type { ProductPerformance } from "@shared/analytics/productPerformance";
import { db } from "../db";
import { lineUnitCostSql } from "./lineCost";

/**
 * Product takings and gross profit on the same basis as Weekly Margin:
 * settled goods takings, allocated sale discounts, returned units and refunds.
 * Delivery fees and personal use do not belong in product sales rankings.
 * The caller supplies the settled window and validated location/staff scope.
 */
export async function productPerformance(scope: SQL | undefined): Promise<ProductPerformance[]> {
  const refundedQty = sql`COALESCE((SELECT SUM(rl.qty) FROM refund_lines rl WHERE rl.order_line_id = ${orderItems.id}), 0)`;
  const refundedAmount = sql`COALESCE((SELECT SUM(rl.amount) FROM refund_lines rl WHERE rl.order_line_id = ${orderItems.id}), 0)`;
  const netQty = sql`(CAST(${orderItems.quantity} AS DECIMAL) - ${refundedQty})`;
  const orderLineValue = sql`(SELECT SUM(CAST(oi2.total_price AS DECIMAL)) FROM order_items oi2 WHERE oi2.order_id = ${orders.id})`;
  const feeCharged = sql`ROUND(COALESCE(${orders.deliveryFee}, 0) * (1 + COALESCE(${orders.vatRate}, 0) / 100), 2)`;
  const goodsSettled = sql`GREATEST(CAST(COALESCE(${orders.settledTotal}, ${orders.total}) AS DECIMAL) - ${feeCharged}, 0)`;
  const netRevenue = sql`((CASE WHEN ${orderLineValue} > 0
    THEN CAST(${orderItems.totalPrice} AS DECIMAL) * ${goodsSettled} / ${orderLineValue}
    ELSE 0 END) - ${refundedAmount})`;
  const unknown = sql`${lineUnitCostSql} IS NULL AND (${netQty} <> 0 OR ${netRevenue} <> 0)`;
  const rows = await db.select({
    productId: products.id,
    name: products.name,
    quantity: sql<number>`SUM(${netQty})`,
    revenue: sql<number>`SUM(${netRevenue})`,
    grossProfit: sql<number | null>`CASE WHEN COUNT(*) FILTER (WHERE ${unknown}) > 0 THEN NULL
      ELSE SUM(${netRevenue} - COALESCE(${netQty} * ${lineUnitCostSql}, 0)) END`,
    missingCostUnits: sql<number>`COALESCE(SUM(${netQty}) FILTER (WHERE ${unknown}), 0)`,
  }).from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .innerJoin(products, eq(orderItems.productId, products.id))
    .where(and(scope, sql`LOWER(COALESCE(${orders.paymentMethod}, '')) <> 'personal_use'`))
    .groupBy(products.id, products.name);

  return rows.map((r) => ({
    productId: r.productId,
    name: r.name,
    quantity: Number(r.quantity),
    revenue: Number(r.revenue),
    grossProfit: r.grossProfit == null ? null : Number(r.grossProfit),
    missingCostUnits: Number(r.missingCostUnits),
  }));
}
