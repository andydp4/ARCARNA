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
import { orders, orderItems, products } from "@shared/schema";
import { and, eq, sql, gte, lte } from "drizzle-orm";

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
    default:
      throw Object.assign(new Error(`Report ${ref} is not available yet`), { statusCode: 404 });
  }
}
