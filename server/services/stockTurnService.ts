import { db } from "../db";
import { orderItems, orders, productLocationStock, products } from "@shared/schema";
import { aggregateStockTurnByCategory } from "@shared/analytics/stockTurn";
import { and, eq, gte, sql } from "drizzle-orm";

export async function getStockTurnAnalytics(orgId: string, windowDays: number) {
  const safeDays = Math.min(Math.max(1, windowDays), 365);
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - safeDays);

  const soldRows = await db
    .select({
      productId: products.productId,
      unitsSold: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .innerJoin(products, eq(orderItems.productId, products.id))
    .where(
      and(
        eq(orders.orgId, orgId),
        eq(orders.status, "completed"),
        gte(orders.createdAt, windowStart),
        eq(products.orgId, orgId),
      ),
    )
    .groupBy(products.id, products.productId);

  const stockRows = await db
    .select({
      productId: products.productId,
      avgStock: sql<number>`coalesce(sum(${productLocationStock.stock}), 0)::int`,
    })
    .from(products)
    .leftJoin(productLocationStock, eq(productLocationStock.productId, products.id))
    .where(eq(products.orgId, orgId))
    .groupBy(products.id, products.productId);

  const soldBySku = new Map(soldRows.map((r) => [r.productId, Number(r.unitsSold) || 0]));
  const stockBySku = new Map(stockRows.map((r) => [r.productId, Number(r.avgStock) || 0]));

  const skus = new Set([...soldBySku.keys(), ...stockBySku.keys()]);
  const productInputs = [...skus].map((productId) => ({
    productId,
    unitsSold: soldBySku.get(productId) ?? 0,
    avgStock: stockBySku.get(productId) ?? 0,
  }));

  const categories = aggregateStockTurnByCategory(productInputs, safeDays);

  return { categories, windowDays: safeDays };
}
