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
import { storage } from "../storage";
import {
  orders,
  orderItems,
  products,
  customers,
  customerMetrics,
  customerRfm,
  suppliers,
  productSuppliers,
  satisfactionScores,
  resellerPartners,
  resellerTransactions,
  cashierProfiles,
  refunds,
  organizations,
  orderEvents,
  opsStaff,
} from "@shared/schema";
import { and, eq, sql, gte, lte, inArray, or } from "drizzle-orm";
import { orgTimeZone } from "./tradingDayShift";
import { currentTradingDay, tradingDayBounds, tradingDayFor } from "@shared/time/tradingDay";
import type { OpsTimingSettings } from "@shared/orders/opsState";
import {
  deriveOrderTiming,
  summarizeOrderTiming,
  orderTimingRedFlags,
  type TimingOrderInput,
  type OrderTimingSummary,
} from "@shared/reports/orderTiming";
import { wasProactiveDelayComms } from "@shared/reports/delayLog";

export { wasProactiveDelayComms };

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
  // Products with current stock + reorder point. Stock comes from
  // getProductsWithStock (summed per-location stock) rather than the legacy
  // products.stock column, which is always written as 0 — reading it directly
  // made every product show as CRITICAL/out of stock and fired a red flag for
  // each one.
  const withStock = await storage.getProductsWithStock(orgId);
  const prodRows = withStock.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.productId,
    stock: p.stock,
    reorderPoint: p.stockLimit,
  }));

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
  // See currentStockLevels: stock must come from getProductsWithStock, not the
  // legacy products.stock column (always 0), or every product reads as out of
  // stock with zero runway.
  const withStock = await storage.getProductsWithStock(orgId);
  const prod = withStock.map((p) => ({ id: p.id, name: p.name, stock: p.stock }));

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

/**
 * ARC-T1-003 Order Status Dashboard — live view of in-flight orders today.
 *
 * Retiring (brief, "Reporting": "ARC-T1-003 retires (the board is that
 * screen)") — the client page, its route and this function's own removal are
 * the second N7 round's job, sequenced after N4b deletes Open Orders. Until
 * then this keeps working, fixed to stop feeding it the two kinds of row the
 * DoD calls out: an order whose `ready_at` is migration 065's backfill
 * (`meta.assumed:true` — a real column with no real "someone marked it ready"
 * moment behind it, see `shared/reports/orderTiming.ts`) would otherwise sit
 * here indefinitely looking queued; and one still open from an earlier
 * trading day (the Operations Centre's own "carried-over" case,
 * `shared/orders/opsState.ts`) does not belong in "today", which this
 * function used to define as the SERVER's calendar midnight rather than the
 * org's 06:00 trading day — fixed to the same trading-day bounds the board
 * uses, not a new rule invented for this report.
 */
export async function orderStatusDashboard(orgId: string): Promise<ReportPayload> {
  const timezone = await orgTimeZone(orgId);
  const tradingDay = currentTradingDay(timezone);
  const { start: startOfDay } = tradingDayBounds(tradingDay, timezone);

  const rows = await db
    .select({
      id: orders.id,
      customer: customers.name,
      tier: customers.category,
      total: orders.total,
      status: orders.status,
      channel: orders.channel,
      paymentMethod: orders.paymentMethod,
      etaGiven: orders.etaGiven,
      delayFlag: orders.delayFlag,
      createdAt: orders.createdAt,
      enteredAt: orders.enteredAt,
    })
    .from(orders)
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .where(
      and(
        eq(orders.orgId, orgId),
        sql`${orders.status} NOT IN ('completed','COLLECTED','collected')`,
        gte(orders.createdAt, startOfDay),
      ),
    );

  const orderIds = rows.map((r) => r.id);
  const readyEvents = orderIds.length
    ? await db
        .select({ orderId: orderEvents.orderId, meta: orderEvents.meta })
        .from(orderEvents)
        .where(and(eq(orderEvents.orgId, orgId), eq(orderEvents.kind, "ready"), inArray(orderEvents.orderId, orderIds)))
    : [];
  // Ordered by nothing in particular, but there is at most one `ready` event
  // per order at this point in the phase (unready/re-ready cycles exist, but
  // the assumed-backfill only ever wrote one and never coexists with a real
  // one for the same order) — a `some()` is exact, not an approximation.
  const assumedReadyOrderIds = new Set(
    readyEvents.filter((e) => (e.meta as { assumed?: boolean } | null)?.assumed === true).map((e) => e.orderId),
  );

  const visibleRows = rows.filter((r) => {
    if (assumedReadyOrderIds.has(r.id)) return false;
    const receivedAt = r.enteredAt ?? r.createdAt;
    if (receivedAt && tradingDayFor(new Date(receivedAt), timezone) < tradingDay) return false; // carried over
    return true;
  });

  const now = Date.now();
  const redFlags: string[] = [];
  const mapped = visibleRows
    .map((r) => {
      const created = r.createdAt ? new Date(r.createdAt).getTime() : now;
      const timeInQueue = Math.floor((now - created) / 60000);
      const stalled = timeInQueue > 45;
      if (r.delayFlag) redFlags.push(`Order for ${r.customer || "customer"} is DELAYED.`);
      return {
        orderId: r.id.slice(0, 8),
        customer: r.customer,
        tier: r.tier,
        orderValue: num(r.total),
        status: r.delayFlag ? "DELAYED" : (r.status || "PENDING").toUpperCase(),
        // Always null since migration 065 dropped `orders.queue_position`: the
        // manual queue number has no writer, the Operations Centre board sorts
        // by due time and state instead, and this report (ARC-T1-003) retires
        // in N7. Kept in the payload only so the column renders "—" rather than
        // the page breaking between the two PRs.
        queuePosition: null as number | null,
        etaGiven: r.etaGiven ? new Date(r.etaGiven).toISOString() : null,
        timeInQueue,
        stalled,
        channel: channelOf(r.paymentMethod, r.channel),
      };
    })
    .sort((a, b) => {
      const vip = (t: string | null) => (VIP_TIERS.some((v) => (t || "").toLowerCase().includes(v)) ? 0 : 1);
      return vip(a.tier) - vip(b.tier);
    });

  return {
    ref: "ARC-T1-003",
    title: "Order Status Dashboard",
    generatedAt: new Date().toISOString(),
    period: { from: startOfDay.toISOString(), to: new Date().toISOString() },
    summary: {
      active: mapped.length,
      delayed: mapped.filter((r) => r.status === "DELAYED").length,
      stalled: mapped.filter((r) => r.stalled).length,
    },
    rows: mapped,
    redFlags,
  };
}

/**
 * ARC-T1-005 Delay Log — every delay cycle in a trading day, cleared or not.
 *
 * Re-sourced from `order_events` (N7; previously read `orders.delayFlag =
 * true` directly, which is exactly wrong for a LOG — the moment a delay is
 * cleared, `delayFlag` goes back to `false` and the row vanished from a
 * report whose entire purpose is to show what happened, not just what is
 * still happening; DoD: "Delay Log shows a cleared delay"). Each `delayed`
 * event is paired with the next `delay_cleared` event on the same order (if
 * any occurred before the trading day ended) to produce one row per delay
 * cycle — an order delayed twice in one day, cleared each time, is two rows,
 * not one overwritten row.
 *
 * `originalEta` and `delayNotificationSentAt` remain single columns on
 * `orders` (not per-cycle) — `set_due`/`due_set` freezes `original_eta` once,
 * and `PATCH …/operations` stamps `delay_notification_sent_at` at whatever
 * moment a notification was last sent. A order delayed more than once in the
 * window therefore shares one proactive-comms verdict across its cycles,
 * exactly the same single-snapshot limitation the pre-N7 implementation had
 * — now visible because multiple cycles can appear, not newly introduced.
 */
export async function delayLog(orgId: string, day: Date): Promise<ReportPayload> {
  const timezone = await orgTimeZone(orgId);
  const tradingDay = currentTradingDay(timezone, day);
  const { start, end } = tradingDayBounds(tradingDay, timezone);

  const events = await db
    .select({ orderId: orderEvents.orderId, kind: orderEvents.kind, at: orderEvents.at, meta: orderEvents.meta })
    .from(orderEvents)
    .where(
      and(
        eq(orderEvents.orgId, orgId),
        inArray(orderEvents.kind, ["delayed", "delay_cleared"]),
        gte(orderEvents.at, start),
        lte(orderEvents.at, end),
      ),
    )
    .orderBy(orderEvents.orderId, orderEvents.at);

  const redFlags: string[] = [];
  if (events.length === 0) {
    return {
      ref: "ARC-T1-005",
      title: "Delay Log",
      generatedAt: new Date().toISOString(),
      period: { from: start.toISOString(), to: end.toISOString() },
      summary: { delays: 0, noProactiveComms: 0, over60min: 0, stillOpen: 0 },
      rows: [],
      redFlags,
    };
  }

  const orderIds = [...new Set(events.map((e) => e.orderId))];
  const [orderRows, heldEvents] = await Promise.all([
    db
      .select({
        id: orders.id,
        customer: customers.name,
        tier: customers.category,
        originalEta: orders.originalEta,
        delayNotificationSentAt: orders.delayNotificationSentAt,
        assignedUserId: orders.assignedUserId,
      })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(inArray(orders.id, orderIds)),
    db
      .select({ orderId: orderEvents.orderId, meta: orderEvents.meta })
      .from(orderEvents)
      .where(and(eq(orderEvents.orgId, orgId), eq(orderEvents.kind, "unheld"), inArray(orderEvents.orderId, orderIds))),
  ]);
  const orderById = new Map(orderRows.map((r) => [r.id, r]));
  const heldMinutesByOrder = new Map<string, number>();
  for (const e of heldEvents) {
    const seconds = Number((e.meta as { heldSeconds?: number } | null)?.heldSeconds ?? 0);
    heldMinutesByOrder.set(e.orderId, (heldMinutesByOrder.get(e.orderId) ?? 0) + seconds / 60);
  }

  type DelayEventRow = (typeof events)[number];
  const rows: Record<string, unknown>[] = [];

  function pushRow(delayedEvent: DelayEventRow, clearedEvent: DelayEventRow | null) {
    const order = orderById.get(delayedEvent.orderId);
    const meta = (delayedEvent.meta ?? {}) as { cause?: string | null; reason?: string | null; customerTold?: boolean };
    const clearedMeta = (clearedEvent?.meta ?? null) as { resolution?: string | null } | null;
    const orig = order?.originalEta ? new Date(order.originalEta) : null;
    const notifiedAt = order?.delayNotificationSentAt ? new Date(order.delayNotificationSentAt) : null;
    const clearedAt = clearedEvent ? new Date(clearedEvent.at as unknown as string) : null;
    const delayedAt = new Date(delayedEvent.at as unknown as string);
    const duration = clearedAt ? Math.round((clearedAt.getTime() - delayedAt.getTime()) / 60000) : null;
    const proactive = wasProactiveDelayComms(orig, notifiedAt);
    const customerName = order?.customer || "customer";
    if (!proactive) redFlags.push(`Delay for ${customerName} was not proactively communicated.`);
    if (duration != null && duration > 60) redFlags.push(`Delay for ${customerName} exceeded 60 minutes.`);
    rows.push({
      orderId: delayedEvent.orderId.slice(0, 8),
      customer: order?.customer ?? null,
      tier: order?.tier ?? null,
      assignedUserId: order?.assignedUserId ?? null,
      delayedAt: delayedAt.toISOString(),
      clearedAt: clearedAt ? clearedAt.toISOString() : null,
      delayDuration: duration,
      delayCause: meta.cause ?? null,
      delayReason: meta.reason ?? null,
      customerToldAtDelay: Boolean(meta.customerTold),
      proactiveComms: proactive,
      resolution: clearedMeta?.resolution ?? null,
      heldMinutes: Math.round((heldMinutesByOrder.get(delayedEvent.orderId) ?? 0) * 10) / 10,
    });
  }

  const eventsByOrder = new Map<string, DelayEventRow[]>();
  for (const e of events) {
    const bucket = eventsByOrder.get(e.orderId);
    if (bucket) bucket.push(e);
    else eventsByOrder.set(e.orderId, [e]);
  }

  let stillOpen = 0;
  for (const orderEventsForOrder of eventsByOrder.values()) {
    let pending: DelayEventRow | null = null;
    for (const e of orderEventsForOrder) {
      if (e.kind === "delayed") {
        // A second `delayed` with no intervening clear closes the previous
        // cycle as unresolved (still open at the moment it was superseded)
        // rather than being silently overwritten.
        if (pending) pushRow(pending, null);
        pending = e;
      } else if (e.kind === "delay_cleared") {
        if (pending) {
          pushRow(pending, e);
          pending = null;
        }
        // A `delay_cleared` with no pending `delayed` in THIS window means
        // the delay was flagged before the trading day started — outside
        // this report's scope, not an error.
      }
    }
    if (pending) {
      pushRow(pending, null);
      stillOpen += 1;
    }
  }

  return {
    ref: "ARC-T1-005",
    title: "Delay Log",
    generatedAt: new Date().toISOString(),
    period: { from: start.toISOString(), to: end.toISOString() },
    summary: {
      delays: rows.length,
      noProactiveComms: rows.filter((r) => !r.proactiveComms).length,
      over60min: rows.filter((r) => typeof r.delayDuration === "number" && r.delayDuration > 60).length,
      stillOpen,
    },
    rows,
    redFlags,
  };
}

function flattenTimingSummary(summary: OrderTimingSummary): Record<string, number | string | null> {
  return {
    ordersConsidered: summary.ordersConsidered,
    ordersExcluded: summary.ordersExcluded,
    excludedBackdated: summary.excludedBackdated,
    excludedCarriedOver: summary.excludedCarriedOver,
    excludedAssumedReady: summary.excludedAssumedReady,
    withPromisePercent: summary.withPromisePercent,
    onTimePercent: summary.onTimePercent,
    collectionOnTimePercent: summary.collectionOnTimePercent,
    deliveryOnTimePercent: summary.deliveryOnTimePercent,
    deliveryP90ReceivedToCompletedMinutes: summary.deliveryP90ReceivedToCompletedMinutes,
    promiseKeptPercent: summary.promiseKeptPercent,
    averageLatenessMinutes: summary.averageLatenessMinutes,
    medianReceivedToClaimedMinutes: summary.medians.receivedToClaimedMinutes,
    medianReceivedToReadyMinutes: summary.medians.receivedToReadyMinutes,
    medianReadyToHandoverMinutes: summary.medians.readyToHandoverMinutes,
    medianArrivedToHandoverMinutes: summary.medians.arrivedToHandoverMinutes,
    medianDispatchToDeliveredMinutes: summary.medians.dispatchToDeliveredMinutes,
    medianReceivedToCompletedMinutes: summary.medians.receivedToCompletedMinutes,
    p90ReceivedToClaimedMinutes: summary.p90s.receivedToClaimedMinutes,
    p90ReceivedToReadyMinutes: summary.p90s.receivedToReadyMinutes,
    p90ReadyToHandoverMinutes: summary.p90s.readyToHandoverMinutes,
    p90ArrivedToHandoverMinutes: summary.p90s.arrivedToHandoverMinutes,
    p90DispatchToDeliveredMinutes: summary.p90s.dispatchToDeliveredMinutes,
    p90ReceivedToCompletedMinutes: summary.p90s.receivedToCompletedMinutes,
    delayedCount: summary.delayedCount,
    revisedPromiseAccuracyPercent: summary.revisedPromiseAccuracyPercent,
    customerWaitingIncidents: summary.customerWaitingIncidents,
    heldOrdersCount: summary.heldOrdersCount,
    averageHeldMinutes: summary.averageHeldMinutes,
    unassignedOrdersCount: summary.unassignedOrdersCount,
    averageUnassignedMinutes: summary.averageUnassignedMinutes,
    alertToAckMedianMinutes: summary.alertToAckMedianMinutes,
    alertToReadyMedianMinutes: summary.alertToReadyMedianMinutes,
  };
}

/**
 * ARC-T2-005 Order Timing & Service Levels — the "engine" half of N7's maths
 * + engine round (docs/briefs/PHASE_N_OPERATIONS_CENTRE.md, "Reporting"). All
 * the actual judgement (on-time, promise-kept, exclusions, percentiles,
 * groupings, red flags) lives in `shared/reports/orderTiming.ts`, pure and
 * unit-tested on its own; this function's only job is assembling one
 * `TimingOrderInput` per order from `orders` + `order_events` and handing the
 * array to it.
 *
 * **Window.** An order is IN the report if it was received in `[from, to)`
 * (fresh work) OR settled in `[from, to)` (a completion the window should
 * see, including a carried-over one from an earlier trading day — counted,
 * then excluded from the figures by the pure module rather than missing from
 * the report altogether). `from`/`to` are ordinary instants, not
 * trading-day-snapped, by design: a caller reporting on exactly one trading
 * day passes `tradingDayBounds(...)`.
 *
 * **Re-settlement.** `completed` events are read ordered ascending by `at`
 * and folded into a `Map<orderId, actualAt | null>` — a resettled order (N3b:
 * reopened, then re-completed, writing a SECOND `completed` event with
 * `meta.resettled:true`) simply overwrites its own map entry with the later
 * event, so the map holds the CURRENT settlement's `meta.actualAt` with no
 * `resettled`-specific branch needed. The overwrite on each `completed` event
 * is UNCONDITIONAL — including writing `null` when that particular event
 * carries no `actualAt` — so the LAST event ascending by `at` always wins,
 * never merely the last one that happens to carry a value: a driver-reported
 * `actualAt` on an early completion must not survive an ordinary
 * (no-`actualAt`) re-completion. Every other per-order fact here —
 * `orders.settledAt`, `completedUserId`, `status` — is read straight off the
 * CURRENT `orders` row, which `orderCompletion.ts` already rewrites in place
 * on re-settle, so a resettled order is one row in, one row out, everywhere
 * in this function. `server/__tests__/orderTimingReport.test.ts` proves both
 * of these against a real reopen + re-complete.
 */
export async function orderTimingReport(orgId: string, from: Date, to: Date): Promise<ReportPayload> {
  const timezone = await orgTimeZone(orgId);
  const [org] = await db
    .select({
      prepSlaMinutes: organizations.opsPrepSlaMinutes,
      deliveryLeadMinutes: organizations.opsDeliveryLeadMinutes,
      dueSoonLeadMinutes: organizations.opsDueSoonLeadMinutes,
      lateGraceMinutes: organizations.opsLateGraceMinutes,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  const settings: OpsTimingSettings = {
    timezone,
    prepSlaMinutes: org?.prepSlaMinutes ?? 20,
    deliveryLeadMinutes: org?.deliveryLeadMinutes ?? 45,
    dueSoonLeadMinutes: org?.dueSoonLeadMinutes ?? 10,
    lateGraceMinutes: org?.lateGraceMinutes ?? 5,
  };

  const emptyPayload = (): ReportPayload => ({
    ref: "ARC-T2-005",
    title: "Order Timing & Service Levels",
    generatedAt: new Date().toISOString(),
    period: { from: from.toISOString(), to: to.toISOString() },
    summary: flattenTimingSummary(summarizeOrderTiming([])),
    rows: [],
    redFlags: [],
  });

  const orderRows = await db
    .select({
      id: orders.id,
      status: orders.status,
      fulfilmentMethod: orders.fulfilmentMethod,
      dateKind: orders.dateKind,
      channel: orders.channel,
      createdAt: orders.createdAt,
      enteredAt: orders.enteredAt,
      etaGiven: orders.etaGiven,
      revisedEta: orders.revisedEta,
      delayFlag: orders.delayFlag,
      heldAt: orders.heldAt,
      readyAt: orders.readyAt,
      customerArrivedAt: orders.customerArrivedAt,
      outForDeliveryAt: orders.outForDeliveryAt,
      settledAt: orders.settledAt,
      assignedUserId: orders.assignedUserId,
      completedUserId: orders.completedUserId,
      inputUserId: orders.inputUserId,
    })
    .from(orders)
    .where(
      and(
        eq(orders.orgId, orgId),
        or(
          and(gte(orders.enteredAt, from), lte(orders.enteredAt, to)),
          and(eq(orders.status, "completed"), gte(orders.settledAt, from), lte(orders.settledAt, to)),
        ),
      ),
    );

  if (orderRows.length === 0) return emptyPayload();

  const orderIds = orderRows.map((r) => r.id);
  const events = await db
    .select({ orderId: orderEvents.orderId, kind: orderEvents.kind, at: orderEvents.at, meta: orderEvents.meta })
    .from(orderEvents)
    .where(
      and(
        eq(orderEvents.orgId, orgId),
        inArray(orderEvents.orderId, orderIds),
        inArray(orderEvents.kind, ["assigned", "delayed", "unheld", "ready", "completed"]),
      ),
    )
    .orderBy(orderEvents.orderId, orderEvents.at);

  const claimedAtByOrder = new Map<string, Date>();
  const wasDelayedByOrder = new Set<string>();
  const latestRevisedByOrder = new Map<string, Date | null>();
  const heldSecondsByOrder = new Map<string, number>();
  const readyAssumedByOrder = new Map<string, boolean>();
  // Ascending `at` per order (the `orderBy` above), so the LAST write for a
  // given key below is always the most recent event of that kind — the
  // dedupe rule this function's own doc comment describes. Every `completed`
  // event is written unconditionally (including `null` when that particular
  // event carries no `actualAt`), so a later ORDINARY re-completion correctly
  // clears an earlier event's override rather than leaving it stuck — see
  // the "driver-reported actualAt on the FIRST completion" test.
  const handoverOverrideByOrder = new Map<string, Date | null>();

  for (const e of events) {
    const meta = (e.meta ?? {}) as Record<string, unknown>;
    switch (e.kind) {
      case "assigned":
        if (!claimedAtByOrder.has(e.orderId)) claimedAtByOrder.set(e.orderId, new Date(e.at as unknown as string));
        break;
      case "delayed":
        wasDelayedByOrder.add(e.orderId);
        latestRevisedByOrder.set(e.orderId, meta.revisedEta ? new Date(meta.revisedEta as string) : null);
        break;
      case "unheld":
        heldSecondsByOrder.set(e.orderId, (heldSecondsByOrder.get(e.orderId) ?? 0) + Number(meta.heldSeconds ?? 0));
        break;
      case "ready":
        readyAssumedByOrder.set(e.orderId, meta.assumed === true);
        break;
      case "completed": {
        // Always overwrite — including with `null` when THIS event has no
        // `actualAt` — so the LAST `completed` event ascending by `at` wins,
        // not merely the last one that happens to carry a value. Otherwise a
        // driver-reported `actualAt` on an early completion would survive a
        // reopen + ordinary re-complete forever, reading the report off a
        // stale, superseded handover time instead of the current settlement.
        const actualAt = meta.actualAt ? new Date(meta.actualAt as string) : null;
        handoverOverrideByOrder.set(e.orderId, actualAt);
        break;
      }
    }
  }

  const assigneeIds = [...new Set(orderRows.map((r) => r.assignedUserId).filter((v): v is string => Boolean(v)))];
  const stationByUser = new Map<string, string | null>();
  if (assigneeIds.length) {
    const staffRows = await db
      .select({ userId: opsStaff.userId, station: opsStaff.station })
      .from(opsStaff)
      .where(and(eq(opsStaff.orgId, orgId), inArray(opsStaff.userId, assigneeIds)));
    for (const s of staffRows) stationByUser.set(s.userId, s.station);
  }

  const timingInputs: TimingOrderInput[] = orderRows.map((r) => ({
    id: r.id,
    status: r.status ?? "pending",
    fulfilmentMethod: r.fulfilmentMethod === "delivery" ? "delivery" : "collection",
    dateKind: r.dateKind === "backdated" || r.dateKind === "preorder" ? r.dateKind : "live",
    channel: r.channel ?? "pos",
    createdAt: r.createdAt ?? new Date(0),
    enteredAt: r.enteredAt,
    etaGiven: r.etaGiven,
    revisedEta: r.revisedEta,
    delayFlag: r.delayFlag === true,
    heldAt: r.heldAt,
    readyAt: r.readyAt,
    customerArrivedAt: r.customerArrivedAt,
    outForDeliveryAt: r.outForDeliveryAt,
    settledAt: r.settledAt,
    handoverAt: handoverOverrideByOrder.get(r.id) ?? r.settledAt,
    claimedAt: claimedAtByOrder.get(r.id) ?? null,
    wasDelayed: wasDelayedByOrder.has(r.id),
    revisedPromiseAtDelay: latestRevisedByOrder.get(r.id) ?? null,
    heldSeconds: heldSecondsByOrder.get(r.id) ?? 0,
    assignedUserId: r.assignedUserId,
    completedUserId: r.completedUserId,
    inputUserId: r.inputUserId,
    station: r.assignedUserId ? (stationByUser.get(r.assignedUserId) ?? null) : null,
    readyAssumed: readyAssumedByOrder.get(r.id) ?? false,
  }));

  const facts = timingInputs.map((input) => deriveOrderTiming(input, settings));
  const summary = summarizeOrderTiming(facts);
  const redFlags = orderTimingRedFlags(summary);

  const rows = facts.map((f) => ({
    orderId: f.id.slice(0, 8),
    fulfilmentMethod: f.fulfilmentMethod,
    channel: f.channel,
    tradingDay: f.tradingDay,
    excluded: f.excluded === false ? null : f.excluded,
    hasPromise: f.hasPromise,
    onTime: f.onTime,
    promiseKept: f.promiseKept,
    latenessMinutes: f.latenessMinutes,
    receivedToClaimedMinutes: f.receivedToClaimedMinutes,
    receivedToReadyMinutes: f.receivedToReadyMinutes,
    readyToHandoverMinutes: f.readyToHandoverMinutes,
    arrivedToHandoverMinutes: f.arrivedToHandoverMinutes,
    dispatchToDeliveredMinutes: f.dispatchToDeliveredMinutes,
    receivedToCompletedMinutes: f.receivedToCompletedMinutes,
    wasDelayed: f.wasDelayed,
    revisedPromiseKept: f.revisedPromiseKept,
    customerWaitingIncident: f.customerWaitingIncident,
    heldMinutes: Math.round((f.heldSeconds / 60) * 10) / 10,
    assignedUserId: f.assignedUserId,
    completedUserId: f.completedUserId,
    inputUserId: f.inputUserId,
    station: f.station,
  }));

  return {
    ref: "ARC-T2-005",
    title: "Order Timing & Service Levels",
    generatedAt: new Date().toISOString(),
    period: { from: from.toISOString(), to: to.toISOString() },
    summary: flattenTimingSummary(summary),
    rows,
    redFlags,
  };
}

/** ARC-T2-003 Customer Satisfaction Report — weekly scores + low-score follow-ups. */
export async function customerSatisfaction(orgId: string, weekStart: Date, weekEnd: Date): Promise<ReportPayload> {
  const start = new Date(weekStart);
  start.setHours(0, 0, 0, 0);
  const end = new Date(weekEnd);
  end.setHours(23, 59, 59, 999);

  const scores = await db
    .select({
      score: satisfactionScores.score,
      customer: customers.name,
      orderId: satisfactionScores.orderId,
      scoreDate: satisfactionScores.scoreDate,
    })
    .from(satisfactionScores)
    .leftJoin(customers, eq(satisfactionScores.customerId, customers.id))
    .where(and(eq(satisfactionScores.orgId, orgId), gte(satisfactionScores.scoreDate, start), lte(satisfactionScores.scoreDate, end)));

  // Collections this week (completed orders) → response rate denominator.
  const coll = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(orders)
    .where(and(eq(orders.orgId, orgId), completedCond, gte(orders.createdAt, start), lte(orders.createdAt, end)));
  const collections = num(coll[0]?.n);

  const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  const lowScoreRows: Record<string, unknown>[] = [];
  const redFlags: string[] = [];
  for (const s of scores) {
    const sc = num(s.score);
    if (sc >= 1 && sc <= 5) dist[sc] += 1;
    sum += sc;
    if (sc <= 3) {
      lowScoreRows.push({
        customer: s.customer,
        orderId: s.orderId ? String(s.orderId).slice(0, 8) : null,
        score: sc,
        scoreDate: s.scoreDate ? new Date(s.scoreDate).toISOString() : null,
      });
      if (sc <= 2) redFlags.push(`${s.customer || "Customer"} rated ${sc}/5 — personal follow-up today.`);
    }
  }
  const collected = scores.length;
  const avg = collected ? sum / collected : 0;
  const responseRate = collections ? (collected / collections) * 100 : 0;
  if (collected && avg < 4.5) redFlags.push(`Weekly average satisfaction ${avg.toFixed(2)} is below 4.5.`);

  return {
    ref: "ARC-T2-003",
    title: "Customer Satisfaction Report",
    generatedAt: new Date().toISOString(),
    period: { from: start.toISOString(), to: end.toISOString() },
    summary: {
      scoresCollected: collected,
      responseRate,
      averageScore: avg,
      scoresOf3OrBelow: lowScoreRows.length,
      distribution: `1:${dist[1]} 2:${dist[2]} 3:${dist[3]} 4:${dist[4]} 5:${dist[5]}`,
    },
    rows: lowScoreRows,
    redFlags,
  };
}

/** ARC-T2-004 Reseller Credit & Payment Report — partner balances + ageing. */
export async function resellerCredit(orgId: string): Promise<ReportPayload> {
  const partners = await db
    .select({ id: resellerPartners.id, name: resellerPartners.name, code: resellerPartners.partnerCode })
    .from(resellerPartners)
    .where(eq(resellerPartners.orgId, orgId));

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const redFlags: string[] = [];
  const rows: Record<string, unknown>[] = [];
  for (const p of partners) {
    const txns = await db
      .select({
        type: resellerTransactions.type,
        amount: resellerTransactions.amount,
        occurredAt: resellerTransactions.occurredAt,
        invoiceDate: resellerTransactions.invoiceDate,
        paid: resellerTransactions.paid,
      })
      .from(resellerTransactions)
      .where(and(eq(resellerTransactions.orgId, orgId), eq(resellerTransactions.partnerId, p.id)));

    let supplyMtd = 0;
    let paymentsMtd = 0;
    let balance = 0;
    let lastPayment: Date | null = null;
    let lastSupply: Date | null = null;
    let oldestUnpaid: Date | null = null;
    for (const t of txns) {
      const amt = num(t.amount);
      const when = t.occurredAt ? new Date(t.occurredAt) : null;
      if (t.type === "SUPPLY") {
        balance += amt;
        if (when && when >= monthStart) supplyMtd += amt;
        if (when && (!lastSupply || when > lastSupply)) lastSupply = when;
        if (!t.paid) {
          const inv = t.invoiceDate ? new Date(t.invoiceDate) : when;
          if (inv && (!oldestUnpaid || inv < oldestUnpaid)) oldestUnpaid = inv;
        }
      } else if (t.type === "PAYMENT") {
        balance -= amt;
        if (when && when >= monthStart) paymentsMtd += amt;
        if (when && (!lastPayment || when > lastPayment)) lastPayment = when;
      }
    }
    const oldestDays = oldestUnpaid ? Math.floor((Date.now() - oldestUnpaid.getTime()) / 86400000) : 0;
    let status: "CLEAR" | "OUTSTANDING" | "OVERDUE" | "SUPPLY HOLD";
    if (balance <= 0) status = "CLEAR";
    else if (oldestDays <= 7) status = "OUTSTANDING";
    else if (oldestDays <= 13) status = "OVERDUE";
    else status = "SUPPLY HOLD";
    if (status === "SUPPLY HOLD") redFlags.push(`${p.name}: SUPPLY HOLD — ${oldestDays} days overdue.`);

    rows.push({
      partner: p.name,
      partnerCode: p.code,
      stockSuppliedMtd: supplyMtd,
      paymentsReceivedMtd: paymentsMtd,
      currentBalance: balance,
      oldestUnpaidDays: oldestDays,
      accountStatus: status,
      lastPaymentDate: lastPayment ? lastPayment.toISOString() : null,
      lastSupplyDate: lastSupply ? lastSupply.toISOString() : null,
    });
  }
  rows.sort((a, b) => num(b.currentBalance) - num(a.currentBalance));

  return {
    ref: "ARC-T2-004",
    title: "Reseller Credit & Payment Report",
    generatedAt: new Date().toISOString(),
    period: { from: null, to: null },
    summary: {
      partners: rows.length,
      totalOutstanding: rows.reduce((s, r) => s + num(r.currentBalance), 0),
      supplyHolds: rows.filter((r) => r.accountStatus === "SUPPLY HOLD").length,
    },
    rows,
    redFlags,
  };
}

/** ARC-T2-002 Staff KPI Performance Report — weekly KPIs from available signals. */
export async function staffKpiPerformance(orgId: string, weekStart: Date, weekEnd: Date): Promise<ReportPayload> {
  const start = new Date(weekStart);
  start.setHours(0, 0, 0, 0);
  const end = new Date(weekEnd);
  end.setHours(23, 59, 59, 999);

  const staff = await db
    .select({ id: cashierProfiles.id, name: cashierProfiles.displayName })
    .from(cashierProfiles)
    .where(and(eq(cashierProfiles.orgId, orgId), eq(cashierProfiles.isActive, true)));

  const redFlags: string[] = [];
  const rows: Record<string, unknown>[] = [];
  for (const st of staff) {
    // Orders handled this week by this cashier.
    const ord = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.orgId, orgId), eq(orders.cashierId, st.id), gte(orders.createdAt, start), lte(orders.createdAt, end)));
    const orderIds = ord.map((o) => o.id);
    const ordersHandled = orderIds.length;

    // Order accuracy: orders without a refund / total.
    let refunded = 0;
    if (orderIds.length) {
      const rf = await db
        .select({ n: sql<number>`COUNT(DISTINCT ${refunds.orderId})` })
        .from(refunds)
        .where(and(eq(refunds.orgId, orgId), inArray(refunds.orderId, orderIds)));
      refunded = num(rf[0]?.n);
    }
    const accuracy = ordersHandled ? ((ordersHandled - refunded) / ordersHandled) * 100 : null;

    // Satisfaction average attributed to this staff member.
    const sat = await db
      .select({ avg: sql<number>`AVG(${satisfactionScores.score})`, n: sql<number>`COUNT(*)` })
      .from(satisfactionScores)
      .where(and(eq(satisfactionScores.orgId, orgId), eq(satisfactionScores.staffId, st.id), gte(satisfactionScores.scoreDate, start), lte(satisfactionScores.scoreDate, end)));
    const satisfaction = num(sat[0]?.n) ? num(sat[0]?.avg) : null;

    // KPIs at target from what we can measure (accuracy ≥98, satisfaction ≥4.8).
    let atTarget = 0;
    let measured = 0;
    if (accuracy !== null) {
      measured++;
      if (accuracy >= 98) atTarget++;
    }
    if (satisfaction !== null) {
      measured++;
      if (satisfaction >= 4.8) atTarget++;
    }
    // Scale to the 7-KPI bonus bands proportionally to what's measured.
    const projected = measured ? Math.round((atTarget / measured) * 7) : 0;
    let bonusTier: "PLATINUM" | "GOLD" | "SILVER" | "BELOW STANDARD";
    if (projected === 7) bonusTier = "PLATINUM";
    else if (projected >= 5) bonusTier = "GOLD";
    else if (projected >= 3) bonusTier = "SILVER";
    else bonusTier = "BELOW STANDARD";
    const bonusPayable = bonusTier === "PLATINUM" ? 150 : bonusTier === "GOLD" ? 100 : bonusTier === "SILVER" ? 50 : 0;
    if (bonusTier === "BELOW STANDARD" && ordersHandled > 0) redFlags.push(`${st.name} is BELOW STANDARD this week — review.`);

    rows.push({
      staff: st.name,
      ordersHandled,
      orderAccuracyRate: accuracy,
      satisfactionScore: satisfaction,
      kpisAtTarget: atTarget,
      kpisMeasured: measured,
      bonusTier,
      bonusPayable,
    });
  }
  rows.sort((a, b) => num(b.bonusPayable) - num(a.bonusPayable));

  return {
    ref: "ARC-T2-002",
    title: "Staff KPI Performance Report",
    generatedAt: new Date().toISOString(),
    period: { from: start.toISOString(), to: end.toISOString() },
    summary: {
      staff: rows.length,
      platinum: rows.filter((r) => r.bonusTier === "PLATINUM").length,
      belowStandard: rows.filter((r) => r.bonusTier === "BELOW STANDARD").length,
      totalBonus: rows.reduce((s, r) => s + num(r.bonusPayable), 0),
    },
    rows,
    redFlags,
  };
}

export type ReportRef = "ARC-T1-001" | "ARC-T1-002" | "ARC-T1-004" | "ARC-T2-005";

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
    case "ARC-T1-003":
      return orderStatusDashboard(orgId);
    case "ARC-T1-005":
      return delayLog(orgId, opts.from ?? new Date());
    case "ARC-T2-005": {
      const to = opts.to ?? new Date();
      const from = opts.from ?? new Date(to.getTime() - 6 * 86400000);
      return orderTimingReport(orgId, from, to);
    }
    case "ARC-T2-001": {
      const to = opts.to ?? new Date();
      const from = opts.from ?? new Date(to.getTime() - 6 * 86400000);
      return weeklyMarginSummary(orgId, from, to);
    }
    case "ARC-T2-002": {
      const to = opts.to ?? new Date();
      const from = opts.from ?? new Date(to.getTime() - 6 * 86400000);
      return staffKpiPerformance(orgId, from, to);
    }
    case "ARC-T2-003": {
      const to = opts.to ?? new Date();
      const from = opts.from ?? new Date(to.getTime() - 6 * 86400000);
      return customerSatisfaction(orgId, from, to);
    }
    case "ARC-T2-004":
      return resellerCredit(orgId);
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
