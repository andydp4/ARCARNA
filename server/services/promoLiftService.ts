import { db } from "../db";
import { orders, promotions } from "@shared/schema";
import { computePromoLift } from "@shared/analytics/promoLift";
import { and, eq, gte, isNotNull, lt, sql } from "drizzle-orm";

const COMPLETED = "completed";

async function fetchCompletedOrders(orgId: string, from: Date, to: Date) {
  const rows = await db
    .select({
      customerId: orders.customerId,
      total: orders.total,
    })
    .from(orders)
    .where(
      and(
        eq(orders.orgId, orgId),
        eq(orders.status, COMPLETED),
        gte(orders.createdAt, from),
        lt(orders.createdAt, to),
      ),
    );

  return rows.map((r) => ({
    customerId: r.customerId,
    total: parseFloat(String(r.total)) || 0,
  }));
}

async function fetchFirstOrderDates(orgId: string): Promise<Map<string, Date>> {
  const rows = await db
    .select({
      customerId: orders.customerId,
      firstAt: sql<Date>`min(${orders.createdAt})`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.orgId, orgId),
        eq(orders.status, COMPLETED),
        isNotNull(orders.customerId),
      ),
    )
    .groupBy(orders.customerId);

  return new Map(
    rows
      .filter((r) => r.customerId)
      .map((r) => [r.customerId!, new Date(r.firstAt)]),
  );
}

export async function getPromotionLift(
  orgId: string,
  promoId: string,
  baselineWeeks: number,
) {
  const [promo] = await db
    .select()
    .from(promotions)
    .where(and(eq(promotions.id, promoId), eq(promotions.orgId, orgId)));

  if (!promo) return null;

  const safeWeeks = Math.min(Math.max(1, baselineWeeks), 12);
  const promoStart = new Date(promo.startDate);
  const promoEnd = new Date(
    Math.min(new Date(promo.endDate).getTime(), Date.now()),
  );
  const baselineStart = new Date(promoStart);
  baselineStart.setDate(baselineStart.getDate() - safeWeeks * 7);

  const promoEndExclusive = new Date(promoEnd);
  promoEndExclusive.setDate(promoEndExclusive.getDate() + 1);

  const [promoOrders, baselineOrders, firstOrderAtByCustomer] = await Promise.all([
    fetchCompletedOrders(orgId, promoStart, promoEndExclusive),
    fetchCompletedOrders(orgId, baselineStart, promoStart),
    fetchFirstOrderDates(orgId),
  ]);

  return computePromoLift({
    promo: {
      id: promo.id,
      name: promo.name,
      startDate: promoStart,
      endDate: promoEnd,
      usageCount: promo.usageCount,
    },
    baselineWeeks: safeWeeks,
    promoOrders,
    baselineOrders,
    firstOrderAtByCustomer,
    promoWindow: { start: promoStart, end: promoEndExclusive },
    baselineWindow: { start: baselineStart, end: promoStart },
  });
}
