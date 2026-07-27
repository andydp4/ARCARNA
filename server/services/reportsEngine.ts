/**
 * Reports Engine — data for the Arcarna exportable reports (ARC-RPT-SPEC-001).
 *
 * Produces the field rows + summary for each report reference, scoped to an
 * organisation and (optionally) a date range. The client renders these into the
 * branded ReportFrame and exports to PNG/JPEG/PDF/CSV; the same payload backs
 * the `GET /api/reports/:ref` JSON endpoint.
 *
 * This first slice implements the Tier 1 reports whose data exists in the
 * current model (Daily Sales, Weekly Sales, Current Stock). Reports requiring
 * operational order fields (Order Status, Delay Log) and net-new tables
 * (Satisfaction, Reseller, Staff KPI) are added alongside their schema.
 */
import { db } from "../db";
import {
  orders,
  orderItems,
  products,
  customers,
  customerMetrics,
  customerRfm,
  suppliers,
  productSuppliers,
} from "@shared/schema";
import { and, eq, sql, gte, lte, desc } from "drizzle-orm";

/** Statuses that count as realised revenue. Model uses "completed"; spec says COLLECTED. */
const COMPLETED_STATUSES = ["completed", "COLLECTED", "collected"] as const;

export interface ReportPayload {
  ref: string;
  title: string;
  generatedAt: string;
  period: { from: string | null; to: string | null };
  summary: Record<string, number | string | null>;
  rows: Record<string, unknown>[];
  /** Red-flag rows worth a notification (ref-specific meaning). */
  redFlags: string[];
}

function num(v: unknown): number {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return typeof n === "number" && isFinite(n) ? n : 0;
}

/** Bucket a payment method / channel into the spec's four revenue channels. */
function channelOf(paymentMethod: string | null, channel: string | null): "Cash" | "Card" | "Website" | "Reseller" {
  const pm = (paymentMethod || "").toLowerCase();
  const ch = (channel || "").toLowerCase();
  if (ch.includes("reseller") || pm.includes("reseller")) return "Reseller";
  if (ch.includes("web") || ch.includes("online") || ch.includes("site")) return "Website";
  if (pm.includes("cash")) return "Cash";
  return "Card";
}

const completedCond = sql`${orders.status} IN (${sql.join(COMPLETED_STATUSES.map((s) => sql`${s}`), sql`, `)})`;

/** ARC-T1-001 Daily Sales Summary — revenue by channel for a single trading day. */
export async function dailySalesSummary(orgId: string, day: Date): Promise<ReportPayload> {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(day);
  end.setHours(23, 59, 59, 999);

  const dayCond = and(eq(orders.orgId, orgId), completedCond, gte(orders.createdAt, start), lte(orders.createdAt, end));

  const rows = await db
    .select({
      total: orders.total,
      paymentMethod: orders.paymentMethod,
      channel: orders.channel,
    })
    .from(orders)
    .where(dayCond);

  const byChannel: Record<string, number> = { Cash: 0, Card: 0, Website: 0, Reseller: 0 };
  let totalRevenue = 0;
  for (const r of rows) {
    const v = num(r.total);
    totalRevenue += v;
    byChannel[channelOf(r.paymentMethod, r.channel)] += v;
  }
  const ordersProcessed = rows.length;
  const avgOrderValue = ordersProcessed ? totalRevenue / ordersProcessed : 0;

  // vs yesterday & vs same day last week
  const priorTotal = async (offsetDays: number) => {
    const s = new Date(start);
    s.setDate(s.getDate() - offsetDays);
    const e = new Date(end);
    e.setDate(e.getDate() - offsetDays);
    const res = await db
      .select({ total: sql<number>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL)),0)` })
      .from(orders)
      .where(and(eq(orders.orgId, orgId), completedCond, gte(orders.createdAt, s), lte(orders.createdAt, e)));
    return num(res[0]?.total);
  };
  const vsYesterday = totalRevenue - (await priorTotal(1));
  const vsLastWeek = totalRevenue - (await priorTotal(7));

  // 4-week daily average for flag logic
  const avgRes = await db
    .select({ total: sql<number>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL)),0)` })
    .from(orders)
    .where(
      and(
        eq(orders.orgId, orgId),
        completedCond,
        gte(orders.createdAt, new Date(start.getTime() - 28 * 86400000)),
        lte(orders.createdAt, end),
      ),
    );
  const fourWeekDailyAvg = num(avgRes[0]?.total) / 28;

  const redFlags: string[] = [];
  if (fourWeekDailyAvg > 0 && totalRevenue < fourWeekDailyAvg * 0.5) {
    redFlags.push(`Daily revenue ${totalRevenue.toFixed(2)} is below 50% of the 4-week daily average.`);
  }

  return {
    ref: "ARC-T1-001",
    title: "Daily Sales Summary",
    generatedAt: new Date().toISOString(),
    period: { from: start.toISOString(), to: end.toISOString() },
    summary: {
      totalRevenue,
      ordersProcessed,
      cashRevenue: byChannel.Cash,
      cardRevenue: byChannel.Card,
      websiteRevenue: byChannel.Website,
      resellerRevenue: byChannel.Reseller,
      avgOrderValue,
      vsYesterday,
      vsLastWeek,
      fourWeekDailyAvg,
    },
    rows: (["Cash", "Card", "Website", "Reseller"] as const).map((c) => ({
      channel: c,
      revenue: byChannel[c],
      share: totalRevenue ? (byChannel[c] / totalRevenue) * 100 : 0,
    })),
    redFlags,
  };
}

/** ARC-T1-004 Weekly Sales Summary — week revenue, orders, top 5 products, channel mix. */
export async function weeklySalesSummary(orgId: string, weekStart: Date, weekEnd: Date): Promise<ReportPayload> {
  const start = new Date(weekStart);
  start.setHours(0, 0, 0, 0);
  const end = new Date(weekEnd);
  end.setHours(23, 59, 59, 999);
  const weekCond = and(eq(orders.orgId, orgId), completedCond, gte(orders.createdAt, start), lte(orders.createdAt, end));

  const ordRows = await db
    .select({ total: orders.total, paymentMethod: orders.paymentMethod, channel: orders.channel, customerId: orders.customerId, createdAt: orders.createdAt })
    .from(orders)
    .where(weekCond);

  const byChannel: Record<string, number> = { Cash: 0, Card: 0, Website: 0, Reseller: 0 };
  let totalRevenue = 0;
  const dayRevenue: Record<string, number> = {};
  for (const r of ordRows) {
    const v = num(r.total);
    totalRevenue += v;
    byChannel[channelOf(r.paymentMethod, r.channel)] += v;
    const d = r.createdAt ? new Date(r.createdAt).toLocaleDateString("en-GB", { weekday: "long" }) : "—";
    dayRevenue[d] = (dayRevenue[d] || 0) + v;
  }
  const totalOrders = ordRows.length;
  const avgOrderValue = totalOrders ? totalRevenue / totalOrders : 0;
  const peakDay = Object.entries(dayRevenue).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";

  const top = await db
    .select({
      name: products.name,
      units: sql<number>`SUM(${orderItems.quantity})`,
      revenue: sql<number>`SUM(CAST(${orderItems.totalPrice} AS DECIMAL))`,
    })
    .from(orderItems)
    .innerJoin(products, eq(orderItems.productId, products.id))
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(weekCond)
    .groupBy(products.name)
    .orderBy(sql`SUM(${orderItems.quantity}) DESC`)
    .limit(5);

  // Prior week for WoW delta
  const pwStart = new Date(start.getTime() - 7 * 86400000);
  const pwEnd = new Date(end.getTime() - 7 * 86400000);
  const pwRes = await db
    .select({ total: sql<number>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL)),0)` })
    .from(orders)
    .where(and(eq(orders.orgId, orgId), completedCond, gte(orders.createdAt, pwStart), lte(orders.createdAt, pwEnd)));
  const vsPrevWeek = totalRevenue - num(pwRes[0]?.total);

  // 4-week rolling avg for flags
  const rollRes = await db
    .select({ total: sql<number>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL)),0)` })
    .from(orders)
    .where(and(eq(orders.orgId, orgId), completedCond, gte(orders.createdAt, new Date(start.getTime() - 28 * 86400000)), lte(orders.createdAt, end)));
  const fourWeekAvg = num(rollRes[0]?.total) / 4;

  const redFlags: string[] = [];
  if (fourWeekAvg > 0 && totalRevenue < fourWeekAvg * 0.7) {
    redFlags.push(`Weekly revenue ${totalRevenue.toFixed(2)} is below 70% of the 4-week rolling average.`);
  }

  return {
    ref: "ARC-T1-004",
    title: "Weekly Sales Summary",
    generatedAt: new Date().toISOString(),
    period: { from: start.toISOString(), to: end.toISOString() },
    summary: {
      weekEnding: end.toISOString(),
      totalRevenue,
      totalOrders,
      avgOrderValue,
      cashRevenue: byChannel.Cash,
      cardRevenue: byChannel.Card,
      websiteRevenue: byChannel.Website,
      resellerRevenue: byChannel.Reseller,
      vsPrevWeek,
      peakTradingDay: peakDay,
    },
    rows: top.map((t, i) => ({
      rank: i + 1,
      product: t.name,
      units: num(t.units),
      revenue: num(t.revenue),
    })),
    redFlags,
  };
}

/** ARC-T1-002 Current Stock Levels — per-product stock, par level, status, weeks remaining. */
export async function currentStockLevels(orgId: string): Promise<ReportPayload> {
  // Products with current stock + reorder point.
  const prodRows = await db
    .select({
      id: products.id,
      name: products.name,
      sku: products.productId,
      stock: products.stock,
      reorderPoint: products.stockLimit,
    })
    .from(products)
    .where(eq(products.orgId, orgId));

  // 4-week unit velocity per product (from order_items on completed orders).
  const since = new Date(Date.now() - 28 * 86400000);
  const velRows = await db
    .select({
      productId: orderItems.productId,
      units: sql<number>`SUM(${orderItems.quantity})`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(and(eq(orders.orgId, orgId), completedCond, gte(orders.createdAt, since)))
    .groupBy(orderItems.productId);
  const vel = new Map<string, number>();
  for (const v of velRows) vel.set(v.productId as string, num(v.units) / 4);

  const redFlags: string[] = [];
  const rows = prodRows.map((p) => {
    const stock = num(p.stock);
    const par = num(p.reorderPoint);
    const weekly = vel.get(p.id) || 0;
    const weeksRemaining = weekly > 0 ? stock / weekly : stock > 0 ? 999 : 0;
    let status: "CRITICAL" | "RED" | "AMBER" | "GREEN";
    if (stock === 0) status = "CRITICAL";
    else if (par > 0 && stock <= par) status = "RED";
    else if (par > 0 && stock <= par * 1.5) status = "AMBER";
    else status = "GREEN";
    if (status === "CRITICAL") redFlags.push(`${p.name} is out of stock (CRITICAL).`);
    else if (status === "RED") redFlags.push(`${p.name} is at/below par level — reorder today.`);
    return {
      product: p.name,
      sku: p.sku,
      unitsInStock: stock,
      parLevel: par,
      status,
      weeksRemaining,
    };
  });
  // Worst first.
  const order = { CRITICAL: 0, RED: 1, AMBER: 2, GREEN: 3 } as const;
  rows.sort((a, b) => order[a.status] - order[b.status] || a.weeksRemaining - b.weeksRemaining);

  return {
    ref: "ARC-T1-002",
    title: "Current Stock Levels",
    generatedAt: new Date().toISOString(),
    period: { from: null, to: null },
    summary: {
      products: rows.length,
      critical: rows.filter((r) => r.status === "CRITICAL").length,
      red: rows.filter((r) => r.status === "RED").length,
      amber: rows.filter((r) => r.status === "AMBER").length,
      green: rows.filter((r) => r.status === "GREEN").length,
    },
    rows,
    redFlags,
  };
}

/** ARC-T2-001 Weekly Margin Summary — realised margin per product for a week. */
export async function weeklyMarginSummary(orgId: string, weekStart: Date, weekEnd: Date): Promise<ReportPayload> {
  const start = new Date(weekStart);
  start.setHours(0, 0, 0, 0);
  const end = new Date(weekEnd);
  end.setHours(23, 59, 59, 999);
  const cond = and(eq(orders.orgId, orgId), completedCond, gte(orders.createdAt, start), lte(orders.createdAt, end));

  const grp = await db
    .select({
      name: products.name,
      costPrice: products.costPrice,
      units: sql<number>`SUM(${orderItems.quantity})`,
      revenue: sql<number>`SUM(CAST(${orderItems.totalPrice} AS DECIMAL))`,
      minSell: sql<number>`MIN(CAST(${orderItems.unitPrice} AS DECIMAL))`,
      maxSell: sql<number>`MAX(CAST(${orderItems.unitPrice} AS DECIMAL))`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .innerJoin(products, eq(orderItems.productId, products.id))
    .where(cond)
    .groupBy(products.name, products.costPrice);

  const redFlags: string[] = [];
  let totalMarginAll = 0;
  const rows = grp.map((g) => {
    const units = num(g.units);
    const revenue = num(g.revenue);
    const cost = num(g.costPrice);
    const avgSell = units ? revenue / units : 0;
    const grossMargin = avgSell - cost;
    const marginPct = avgSell ? (grossMargin / avgSell) * 100 : 0;
    const totalMargin = grossMargin * units;
    totalMarginAll += totalMargin;
    if (marginPct < 20) redFlags.push(`${g.name} margin ${marginPct.toFixed(1)}% is below 20% — review pricing.`);
    return {
      product: g.name,
      unitsSold: units,
      costPrice: cost,
      avgSellPrice: avgSell,
      minSellPrice: num(g.minSell),
      maxSellPrice: num(g.maxSell),
      grossMargin,
      marginPct,
      totalMargin,
    };
  });
  rows.sort((a, b) => b.totalMargin - a.totalMargin);

  return {
    ref: "ARC-T2-001",
    title: "Weekly Margin Summary",
    generatedAt: new Date().toISOString(),
    period: { from: start.toISOString(), to: end.toISOString() },
    summary: {
      products: rows.length,
      totalMargin: totalMarginAll,
      avgMarginPct: rows.length ? rows.reduce((s, r) => s + r.marginPct, 0) / rows.length : 0,
    },
    rows,
    redFlags,
  };
}

/** Lapse status from days since last order. */
function lapseStatus(days: number): "ACTIVE" | "AT RISK" | "LAPSED" | "LOST" {
  if (days <= 13) return "ACTIVE";
  if (days <= 29) return "AT RISK";
  if (days <= 59) return "LAPSED";
  return "LOST";
}
const VIP_TIERS = ["gold", "platinum", "vip"];
function isVip(tier: string | null): boolean {
  return VIP_TIERS.some((t) => (tier || "").toLowerCase().includes(t));
}

/** ARC-T3-001 Customer Lapse & Retention Report. */
export async function customerLapseRetention(orgId: string): Promise<ReportPayload> {
  const rows = await db
    .select({
      name: customers.name,
      tier: customers.category,
      lastOrder: sql<string>`MAX(${orders.createdAt})`,
      firstOrder: sql<string>`MIN(${orders.createdAt})`,
      orderCount: sql<number>`COUNT(${orders.id})`,
      lifetimeValue: sql<number>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL)),0)`,
    })
    .from(customers)
    .innerJoin(orders, and(eq(orders.customerId, customers.id), completedCond))
    .where(eq(customers.orgId, orgId))
    .groupBy(customers.id, customers.name, customers.category);

  const now = Date.now();
  const redFlags: string[] = [];
  const mapped = rows
    .map((r) => {
      const last = r.lastOrder ? new Date(r.lastOrder) : null;
      const days = last ? Math.floor((now - last.getTime()) / 86400000) : 9999;
      const status = lapseStatus(days);
      if (status !== "ACTIVE" && isVip(r.tier)) redFlags.push(`VIP ${r.name} is ${status} — personal outreach today.`);
      else if (status === "LOST") redFlags.push(`${r.name} is LOST (60+ days) — win-back only.`);
      return {
        customer: r.name,
        tier: r.tier,
        lastOrderDate: last ? last.toISOString() : null,
        daysSinceLastOrder: days,
        lapseStatus: status,
        lifetimeOrders: num(r.orderCount),
        lifetimeValue: num(r.lifetimeValue),
      };
    })
    .filter((r) => r.lapseStatus !== "ACTIVE")
    .sort((a, b) => b.lifetimeValue - a.lifetimeValue);

  return {
    ref: "ARC-T3-001",
    title: "Customer Lapse & Retention Report",
    generatedAt: new Date().toISOString(),
    period: { from: null, to: null },
    summary: {
      atRisk: mapped.filter((r) => r.lapseStatus === "AT RISK").length,
      lapsed: mapped.filter((r) => r.lapseStatus === "LAPSED").length,
      lost: mapped.filter((r) => r.lapseStatus === "LOST").length,
      valueAtRisk: mapped.reduce((s, r) => s + r.lifetimeValue, 0),
    },
    rows: mapped,
    redFlags,
  };
}

/** ARC-T3-002 Customer Lifetime Value (CLV) Report. */
export async function customerLifetimeValue(orgId: string): Promise<ReportPayload> {
  const rows = await db
    .select({
      name: customers.name,
      tier: customers.category,
      lifetimeSpend: sql<number>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL)),0)`,
      totalOrders: sql<number>`COUNT(${orders.id})`,
      firstOrder: sql<string>`MIN(${orders.createdAt})`,
    })
    .from(customers)
    .innerJoin(orders, and(eq(orders.customerId, customers.id), completedCond))
    .where(eq(customers.orgId, orgId))
    .groupBy(customers.id, customers.name, customers.category);

  const now = Date.now();
  const mapped = rows
    .map((r) => {
      const spend = num(r.lifetimeSpend);
      const count = num(r.totalOrders);
      const first = r.firstOrder ? new Date(r.firstOrder) : null;
      const tenureMonths = first ? Math.max(1, Math.round((now - first.getTime()) / (30 * 86400000))) : 1;
      return {
        customer: r.name,
        tier: r.tier,
        lifetimeSpend: spend,
        totalOrders: count,
        avgOrderValue: count ? spend / count : 0,
        firstOrderDate: first ? first.toISOString() : null,
        tenureMonths,
        monthlySpendRate: spend / tenureMonths,
        tierChangeFlag: count >= 10 && !isVip(r.tier) ? "PROMOTE TO VIP" : "",
      };
    })
    .sort((a, b) => b.lifetimeSpend - a.lifetimeSpend)
    .map((r, i) => ({ ...r, clvRank: i + 1 }));

  const redFlags: string[] = [];
  for (const r of mapped) if (r.tierChangeFlag) redFlags.push(`${r.customer}: ${r.tierChangeFlag} (${r.totalOrders} orders).`);

  return {
    ref: "ARC-T3-002",
    title: "Customer Lifetime Value (CLV) Report",
    generatedAt: new Date().toISOString(),
    period: { from: null, to: null },
    summary: {
      customers: mapped.length,
      totalLifetimeSpend: mapped.reduce((s, r) => s + r.lifetimeSpend, 0),
      promoteCandidates: mapped.filter((r) => r.tierChangeFlag).length,
    },
    rows: mapped,
    redFlags,
  };
}

/** ARC-T3-003 Stock Runway & Demand Forecast. */
export async function stockRunwayForecast(orgId: string): Promise<ReportPayload> {
  const prod = await db
    .select({ id: products.id, name: products.name, stock: products.stock })
    .from(products)
    .where(eq(products.orgId, orgId));

  const since = new Date(Date.now() - 28 * 86400000);
  const velRows = await db
    .select({ productId: orderItems.productId, units: sql<number>`SUM(${orderItems.quantity})` })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(and(eq(orders.orgId, orgId), completedCond, gte(orders.createdAt, since)))
    .groupBy(orderItems.productId);
  const vel = new Map<string, number>();
  for (const v of velRows) vel.set(v.productId as string, num(v.units) / 4);

  // Preferred supplier lead time per product.
  const leadRows = await db
    .select({
      productId: productSuppliers.productId,
      override: productSuppliers.leadTimeOverrideDays,
      supplierLead: suppliers.leadTimeDays,
      preferred: productSuppliers.isPreferred,
    })
    .from(productSuppliers)
    .leftJoin(suppliers, eq(productSuppliers.supplierId, suppliers.id))
    .where(eq(productSuppliers.orgId, orgId));
  const lead = new Map<string, number>();
  for (const l of leadRows) {
    const days = num(l.override) || num(l.supplierLead);
    const prev = lead.get(l.productId as string);
    if (prev === undefined || l.preferred) lead.set(l.productId as string, days);
  }

  const redFlags: string[] = [];
  const rows = prod.map((p) => {
    const stock = num(p.stock);
    const weekly = vel.get(p.id) || 0;
    const leadDays = lead.get(p.id) || 7;
    const leadWeeks = leadDays / 7;
    const weeksRemaining = weekly > 0 ? stock / weekly : stock > 0 ? 999 : 0;
    const reorderQty = Math.ceil(weekly * (leadWeeks + 2));
    const reorderByMs = Date.now() + weeksRemaining * 7 * 86400000 - leadDays * 86400000 - 7 * 86400000;
    let urgency: "ORDER NOW" | "ORDER THIS WEEK" | "MONITOR" | "STOCK OK";
    if (weeksRemaining <= leadWeeks) urgency = "ORDER NOW";
    else if (weeksRemaining <= leadWeeks + 1) urgency = "ORDER THIS WEEK";
    else if (weeksRemaining <= 4) urgency = "MONITOR";
    else urgency = "STOCK OK";
    if (urgency === "ORDER NOW") redFlags.push(`${p.name}: ORDER NOW — ${weeksRemaining.toFixed(1)} weeks of stock left.`);
    return {
      product: p.name,
      currentStock: stock,
      avgWeeklySales: weekly,
      weeksRemaining,
      reorderBy: weekly > 0 ? new Date(reorderByMs).toISOString() : null,
      leadTimeDays: leadDays,
      reorderQty,
      urgency,
    };
  });
  const ord = { "ORDER NOW": 0, "ORDER THIS WEEK": 1, MONITOR: 2, "STOCK OK": 3 } as const;
  rows.sort((a, b) => ord[a.urgency] - ord[b.urgency] || a.weeksRemaining - b.weeksRemaining);

  return {
    ref: "ARC-T3-003",
    title: "Stock Runway & Demand Forecast",
    generatedAt: new Date().toISOString(),
    period: { from: null, to: null },
    summary: {
      products: rows.length,
      orderNow: rows.filter((r) => r.urgency === "ORDER NOW").length,
      orderThisWeek: rows.filter((r) => r.urgency === "ORDER THIS WEEK").length,
    },
    rows,
    redFlags,
  };
}

const RFM_ACTION: Record<string, string> = {
  Champions: "Maintain VIP service; offer an exclusive loyalty benefit.",
  Loyal: "Upsell relevant products; keep engagement high.",
  "New Customer": "Onboard well; encourage a second order.",
  "At Risk": "Reactivation campaign — owner approves copy.",
  Hibernating: "Low-cost win-back message.",
  Lost: "Win-back only; do not over-invest.",
};

/** ARC-T4-001 RFM Customer Segmentation — from precomputed customer_rfm. */
export async function rfmSegmentation(orgId: string): Promise<ReportPayload> {
  const rows = await db
    .select({
      name: customers.name,
      tier: customers.category,
      r: customerRfm.recencyScore,
      f: customerRfm.frequencyScore,
      m: customerRfm.monetaryScore,
      segment: customerRfm.segment,
    })
    .from(customerRfm)
    .innerJoin(customers, eq(customerRfm.customerId, customers.id))
    .where(eq(customerRfm.orgId, orgId));

  const redFlags: string[] = [];
  const mapped = rows
    .map((r) => {
      const combined = num(r.r) + num(r.f) + num(r.m);
      if (r.segment === "At Risk" && isVip(r.tier)) redFlags.push(`VIP ${r.name} is At Risk — owner outreach this week.`);
      return {
        customer: r.name,
        recency: num(r.r),
        frequency: num(r.f),
        monetary: num(r.m),
        combined,
        segment: r.segment,
        recommendedAction: RFM_ACTION[r.segment] || "Review manually.",
      };
    })
    .sort((a, b) => b.combined - a.combined);

  const bySeg: Record<string, number> = {};
  for (const r of mapped) bySeg[r.segment] = (bySeg[r.segment] || 0) + 1;

  return {
    ref: "ARC-T4-001",
    title: "RFM Customer Segmentation",
    generatedAt: new Date().toISOString(),
    period: { from: null, to: null },
    summary: {
      customers: mapped.length,
      champions: bySeg["Champions"] || 0,
      atRisk: bySeg["At Risk"] || 0,
    },
    rows: mapped,
    redFlags,
  };
}

/** ARC-T4-002 Churn Risk Score — heuristic early-warning from recency + activity. */
export async function churnRiskScore(orgId: string): Promise<ReportPayload> {
  const rows = await db
    .select({
      name: customers.name,
      tier: customers.category,
      lastOrder: sql<string>`MAX(${orders.createdAt})`,
      orderCount: sql<number>`COUNT(${orders.id})`,
      spend: sql<number>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL)),0)`,
      firstOrder: sql<string>`MIN(${orders.createdAt})`,
    })
    .from(customers)
    .innerJoin(orders, and(eq(orders.customerId, customers.id), completedCond))
    .where(eq(customers.orgId, orgId))
    .groupBy(customers.id, customers.name, customers.category);

  const now = Date.now();
  const redFlags: string[] = [];
  const mapped = rows
    .map((r) => {
      const last = r.lastOrder ? new Date(r.lastOrder) : null;
      const days = last ? Math.floor((now - last.getTime()) / 86400000) : 9999;
      const first = r.firstOrder ? new Date(r.firstOrder) : null;
      const tenureMonths = first ? Math.max(1, Math.round((now - first.getTime()) / (30 * 86400000))) : 1;
      const spend = num(r.spend);
      const monthlyRate = spend / tenureMonths;
      // Recency dominates (40% weight, saturating at 45 days), thinner order
      // history raises risk, higher monthly value lowers "safety".
      const recencyRisk = Math.min(1, days / 45) * 40;
      const freqRisk = num(r.orderCount) <= 2 ? 30 : num(r.orderCount) <= 5 ? 15 : 0;
      const valueGuard = monthlyRate > 50 ? -10 : 0;
      const score = Math.max(0, Math.min(100, Math.round(recencyRisk + freqRisk + valueGuard + 20)));
      const revenueAtRisk = (monthlyRate * score) / 100;
      let action = "Monitor.";
      if (score >= 80 && isVip(r.tier)) action = "Owner personal contact — same day.";
      else if (score >= 80) action = "Reactivation message within 48 hours.";
      else if (score >= 50) action = "Proactive relevant product message.";
      if (score >= 80 && isVip(r.tier)) redFlags.push(`VIP ${r.name}: churn risk ${score} — owner contact today.`);
      else if (score >= 80) redFlags.push(`${r.name}: churn risk ${score} — reactivate within 48h.`);
      return {
        customer: r.name,
        tier: r.tier,
        churnScore: score,
        daysSinceLastOrder: days,
        revenueAtRisk,
        recommendedAction: action,
      };
    })
    .filter((r) => r.churnScore >= 50)
    .sort((a, b) => b.churnScore * b.revenueAtRisk - a.churnScore * a.revenueAtRisk);

  return {
    ref: "ARC-T4-002",
    title: "Churn Risk Score",
    generatedAt: new Date().toISOString(),
    period: { from: null, to: null },
    summary: {
      atRisk: mapped.length,
      highRisk: mapped.filter((r) => r.churnScore >= 80).length,
      revenueAtRisk: mapped.reduce((s, r) => s + r.revenueAtRisk, 0),
    },
    rows: mapped,
    redFlags,
  };
}

/** ARC-T4-003 Product Affinity & Cross-Sell — products frequently bought together. */
export async function productAffinity(orgId: string): Promise<ReportPayload> {
  // Self-join order_items within the same completed order to count co-purchases.
  const pairRows = await db.execute(sql`
    WITH oi AS (
      SELECT ${orderItems.orderId} AS order_id, ${orderItems.productId} AS product_id
      FROM ${orderItems}
      JOIN ${orders} ON ${orders.id} = ${orderItems.orderId}
      WHERE ${orders.orgId} = ${orgId} AND ${completedCond}
    ),
    pairs AS (
      SELECT a.product_id AS a_id, b.product_id AS b_id, COUNT(*) AS co
      FROM oi a JOIN oi b ON a.order_id = b.order_id AND a.product_id <> b.product_id
      GROUP BY a.product_id, b.product_id
    ),
    totals AS (
      SELECT product_id, COUNT(DISTINCT order_id) AS orders_with
      FROM oi GROUP BY product_id
    )
    SELECT pa.name AS product_a, pb.name AS product_b,
           p.co AS co_count, t.orders_with AS a_orders
    FROM pairs p
    JOIN totals t ON t.product_id = p.a_id
    JOIN ${products} pa ON pa.id = p.a_id
    JOIN ${products} pb ON pb.id = p.b_id
    WHERE t.orders_with > 0 AND (p.co::decimal / t.orders_with) >= 0.15
    ORDER BY (p.co::decimal / t.orders_with) DESC
    LIMIT 100
  `);

  const raw: any[] = (pairRows as any).rows ?? (pairRows as any);
  const redFlags: string[] = [];
  const rows = raw.map((r: any) => {
    const co = num(r.co_count);
    const aOrders = num(r.a_orders);
    const rate = aOrders ? (co / aOrders) * 100 : 0;
    return {
      productA: r.product_a,
      productB: r.product_b,
      coPurchaseRate: rate,
      recommendationScore: rate, // proportional to co-purchase strength
    };
  });

  return {
    ref: "ARC-T4-003",
    title: "Product Affinity & Cross-Sell Report",
    generatedAt: new Date().toISOString(),
    period: { from: null, to: null },
    summary: {
      pairs: rows.length,
      strongPairs: rows.filter((r) => r.coPurchaseRate >= 40).length,
    },
    rows,
    redFlags,
  };
}

export type ReportRef = "ARC-T1-001" | "ARC-T1-002" | "ARC-T1-004";

/** Dispatch a report by reference. */
export async function runReport(
  ref: string,
  orgId: string,
  opts: { from?: Date; to?: Date } = {},
): Promise<ReportPayload> {
  switch (ref) {
    case "ARC-T1-001":
      return dailySalesSummary(orgId, opts.from ?? new Date());
    case "ARC-T1-002":
      return currentStockLevels(orgId);
    case "ARC-T1-004": {
      const to = opts.to ?? new Date();
      const from = opts.from ?? new Date(to.getTime() - 6 * 86400000);
      return weeklySalesSummary(orgId, from, to);
    }
    case "ARC-T2-001": {
      const to = opts.to ?? new Date();
      const from = opts.from ?? new Date(to.getTime() - 6 * 86400000);
      return weeklyMarginSummary(orgId, from, to);
    }
    case "ARC-T3-001":
      return customerLapseRetention(orgId);
    case "ARC-T3-002":
      return customerLifetimeValue(orgId);
    case "ARC-T3-003":
      return stockRunwayForecast(orgId);
    case "ARC-T4-001":
      return rfmSegmentation(orgId);
    case "ARC-T4-002":
      return churnRiskScore(orgId);
    case "ARC-T4-003":
      return productAffinity(orgId);
    default:
      throw Object.assign(new Error(`Report ${ref} is not available yet`), { statusCode: 404 });
  }
}
