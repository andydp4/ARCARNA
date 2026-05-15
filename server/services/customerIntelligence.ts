import { db } from "../db";
import { customers, customerMetrics, orders } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

export type CustomerIntelligence = {
  customerId: string;
  name: string;
  lifetimeValue: number;
  averageOrderValue: number;
  orderCount: number;
  lastOrderAt: string | null;
  daysSinceLastOrder: number | null;
  visitFrequencyDays: number | null;
  inactivityRisk: "low" | "medium" | "high";
  vipCandidate: boolean;
  segment: string;
  statusExplanation: string;
  manualOverrideProtected: boolean;
  category: string | null;
};

function daysBetween(from: Date, to: Date) {
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

export async function computeCustomerIntelligence(
  orgId: string,
  customerId: string,
): Promise<CustomerIntelligence | null> {
  const [cust] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.orgId, orgId)))
    .limit(1);
  if (!cust) return null;

  const [metrics] = await db
    .select()
    .from(customerMetrics)
    .where(eq(customerMetrics.customerId, customerId))
    .limit(1);

  const orderRows = await db
    .select({ createdAt: orders.createdAt, total: orders.total })
    .from(orders)
    .where(and(eq(orders.orgId, orgId), eq(orders.customerId, customerId), eq(orders.status, "completed")))
    .orderBy(desc(orders.createdAt))
    .limit(200);

  const orderCount = metrics?.orderCount ?? orderRows.length ?? 0;

  const ltv =
    parseFloat(String(cust.totalSpent || 0)) ||
    parseFloat(String(metrics?.totalSpent || 0)) ||
    0;

  const lastOrderAt = orderRows[0]?.createdAt
    ? new Date(orderRows[0].createdAt as Date).toISOString()
    : metrics?.lastOrderDate
      ? new Date(String(metrics.lastOrderDate)).toISOString()
      : null;

  const now = new Date();
  const daysSince = lastOrderAt ? daysBetween(new Date(lastOrderAt), now) : null;

  const aov = orderCount > 0 ? ltv / orderCount : 0;

  let firstOrderDays = 365;
  if (orderRows.length > 0) {
    const oldest = orderRows[orderRows.length - 1]?.createdAt;
    if (oldest) firstOrderDays = Math.max(1, daysBetween(new Date(oldest as Date), now));
  }
  const visitFrequencyDays = orderCount > 1 ? firstOrderDays / Math.max(1, orderCount - 1) : null;

  let inactivityRisk: CustomerIntelligence["inactivityRisk"] = "low";
  if (daysSince !== null) {
    if (daysSince > 120) inactivityRisk = "high";
    else if (daysSince > 60) inactivityRisk = "medium";
  } else if (orderCount === 0) inactivityRisk = "medium";

  const vipCandidate =
    cust.manualOverrideProtected !== 1 &&
    ltv >= 500 &&
    (cust.category || "").toUpperCase() !== "VIP";

  let segment = "standard";
  if (orderCount === 0) segment = "prospect";
  else if (inactivityRisk === "high") segment = "at_risk";
  else if (ltv >= 1000) segment = "champion";
  else if (ltv >= 300) segment = "loyal";

  const statusParts: string[] = [];
  statusParts.push(`${orderCount} completed order(s).`);
  statusParts.push(`Lifetime value £${ltv.toFixed(2)}.`);
  if (daysSince !== null) statusParts.push(`Last order ${daysSince} day(s) ago.`);
  if (cust.manualOverrideProtected === 1) statusParts.push("Manual category/segment protection is on.");
  if (vipCandidate) statusParts.push("Eligible for VIP tagging based on spend.");

  return {
    customerId: cust.id,
    name: cust.name,
    lifetimeValue: Math.round(ltv * 100) / 100,
    averageOrderValue: Math.round(aov * 100) / 100,
    orderCount,
    lastOrderAt,
    daysSinceLastOrder: daysSince,
    visitFrequencyDays: visitFrequencyDays != null ? Math.round(visitFrequencyDays * 10) / 10 : null,
    inactivityRisk,
    vipCandidate,
    segment,
    statusExplanation: statusParts.join(" "),
    manualOverrideProtected: cust.manualOverrideProtected === 1,
    category: cust.category ?? null,
  };
}

export async function listCustomerIntelligence(orgId: string, limit = 100): Promise<CustomerIntelligence[]> {
  const rows = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.orgId, orgId))
    .limit(limit);

  const out: CustomerIntelligence[] = [];
  for (const r of rows) {
    const intel = await computeCustomerIntelligence(orgId, r.id);
    if (intel) out.push(intel);
  }
  return out;
}
