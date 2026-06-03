import { db } from "../db";
import { customerRfm, customers, orders, organizations } from "@shared/schema";
import {
  buildRfmHeatmap,
  computeRfmScores,
  RFM_SEGMENTS,
  type RfmCustomerInput,
  type RfmSegment,
} from "@shared/analytics/rfm";
import { and, eq, sql } from "drizzle-orm";

const COMPLETED = "completed";

export async function recomputeOrgRfm(orgId: string): Promise<number> {
  const customerRows = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.orgId, orgId));

  if (customerRows.length === 0) return 0;

  const statsRows = await db
    .select({
      customerId: orders.customerId,
      orderCount: sql<number>`COUNT(*)::int`.as("order_count"),
      totalSpent: sql<number>`COALESCE(SUM(CASE WHEN ${orders.total}::numeric >= 0 THEN ${orders.total}::numeric ELSE 0 END), 0)::float`.as(
        "total_spent",
      ),
      lastOrderAt: sql<Date | null>`MAX(${orders.createdAt})`.as("last_order_at"),
    })
    .from(orders)
    .where(and(eq(orders.orgId, orgId), eq(orders.status, COMPLETED), sql`${orders.customerId} IS NOT NULL`))
    .groupBy(orders.customerId);

  const statsByCustomer = new Map(
    statsRows
      .filter((r) => r.customerId)
      .map((r) => [r.customerId as string, r]),
  );

  const now = Date.now();
  const inputs: RfmCustomerInput[] = customerRows.map((c) => {
    const stats = statsByCustomer.get(c.id);
    if (!stats || !stats.lastOrderAt) {
      return { customerId: c.id, orderCount: 0, totalSpent: 0, recencyDays: null };
    }
    const recencyDays = Math.floor((now - new Date(stats.lastOrderAt).getTime()) / (1000 * 60 * 60 * 24));
    return {
      customerId: c.id,
      orderCount: stats.orderCount,
      totalSpent: Number(stats.totalSpent) || 0,
      recencyDays,
    };
  });

  const scores = computeRfmScores(inputs);
  const computedAt = new Date();

  await db.delete(customerRfm).where(eq(customerRfm.orgId, orgId));

  if (scores.length > 0) {
    await db.insert(customerRfm).values(
      scores.map((s) => ({
        orgId,
        customerId: s.customerId,
        recencyScore: s.recencyScore,
        frequencyScore: s.frequencyScore,
        monetaryScore: s.monetaryScore,
        segment: s.segment,
        computedAt,
      })),
    );
  }

  return scores.length;
}

export async function recomputeAllOrgsRfm(): Promise<void> {
  const orgs = await db.select({ id: organizations.id }).from(organizations);
  for (const org of orgs) {
    try {
      const count = await recomputeOrgRfm(org.id);
      console.log(`[RFM] Recomputed ${count} customers for org ${org.id}`);
    } catch (e) {
      console.error(`[RFM] Failed for org ${org.id}:`, e);
    }
  }
}

export async function getRfmSummary(orgId: string) {
  const rows = await db
    .select({
      segment: customerRfm.segment,
      count: sql<number>`COUNT(*)::int`.as("count"),
    })
    .from(customerRfm)
    .where(eq(customerRfm.orgId, orgId))
    .groupBy(customerRfm.segment);

  const counts = Object.fromEntries(RFM_SEGMENTS.map((s) => [s, 0])) as Record<RfmSegment, number>;
  for (const row of rows) {
    const seg = row.segment as RfmSegment;
    if (seg in counts) counts[seg] = row.count;
  }

  const allScores = await db
    .select({
      customerId: customerRfm.customerId,
      recencyScore: customerRfm.recencyScore,
      frequencyScore: customerRfm.frequencyScore,
      monetaryScore: customerRfm.monetaryScore,
      segment: customerRfm.segment,
    })
    .from(customerRfm)
    .where(eq(customerRfm.orgId, orgId));

  const monetaryRows = await db
    .select({ id: customers.id, totalSpent: customers.totalSpent })
    .from(customers)
    .where(eq(customers.orgId, orgId));

  const monetaryByCustomer = new Map(
    monetaryRows.map((r) => [r.id, parseFloat(String(r.totalSpent) || "0")]),
  );

  const heatmap = buildRfmHeatmap(
    allScores.map((s) => ({
      customerId: s.customerId,
      recencyScore: s.recencyScore,
      frequencyScore: s.frequencyScore,
      monetaryScore: s.monetaryScore,
      segment: s.segment as RfmSegment,
    })),
    monetaryByCustomer,
  );

  const lastComputed = await db
    .select({ computedAt: customerRfm.computedAt })
    .from(customerRfm)
    .where(eq(customerRfm.orgId, orgId))
    .limit(1);

  return {
    segments: counts,
    heatmap,
    computedAt: lastComputed[0]?.computedAt ?? null,
    totalCustomers: allScores.length,
  };
}

export async function getRfmCustomersBySegment(
  orgId: string,
  segment: RfmSegment,
  limit = 50,
  offset = 0,
) {
  const rows = await db
    .select({
      customerId: customerRfm.customerId,
      name: customers.name,
      email: customers.email,
      recencyScore: customerRfm.recencyScore,
      frequencyScore: customerRfm.frequencyScore,
      monetaryScore: customerRfm.monetaryScore,
      segment: customerRfm.segment,
      totalSpent: customers.totalSpent,
      loyaltyPoints: customers.loyaltyPoints,
    })
    .from(customerRfm)
    .innerJoin(customers, eq(customers.id, customerRfm.customerId))
    .where(and(eq(customerRfm.orgId, orgId), eq(customerRfm.segment, segment)))
    .limit(limit)
    .offset(offset);

  return rows;
}
