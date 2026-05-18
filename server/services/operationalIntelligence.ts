/**
 * Phase 9 operational intelligence — read-only aggregations over existing data.
 * No second analytics pipeline; uses orders, products, event bus, and movements.
 */
import { db } from "../db";
import {
  products,
  productLocationStock,
  orders,
  orderItems,
  customers,
  inventoryMovements,
  eventOutbox,
  workerRunLogs,
  deadLetters,
  userApprovalRequests,
  analyticsDaily,
  orgNotifications,
} from "@shared/schema";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import { getJobQueueStats } from "../eventBus";

const COMPLETED_STATUS = "completed";
const DEFAULT_WINDOW_DAYS = 30;

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type SmartStockItem = {
  productId: string;
  sku: string;
  name: string;
  stock: number;
  stockLimit: number;
  unitsSoldWindow: number;
  velocityPerDay: number;
  daysToDepletion: number | null;
  daysToDepletionLabel: string;
  deadStock: boolean;
  reorderSuggestion: number | null;
  reorderNote: string | null;
  riskScore: number;
  riskLevel: RiskLevel;
  anomalyNegativeStock: boolean;
};

function riskLevelFromScore(score: number): RiskLevel {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

function computeRiskScore(
  stock: number,
  stockLimit: number,
  daysToDepletion: number | null,
  deadStock: boolean,
  negative: boolean,
): number {
  if (negative) return 95;
  let score = 0;
  if (stock <= 0) score += 40;
  else if (stockLimit > 0 && stock / stockLimit <= 0.2) score += 30;
  if (daysToDepletion !== null && daysToDepletion < 7) score += 35;
  else if (daysToDepletion !== null && daysToDepletion < 14) score += 20;
  if (deadStock && stock > 0) score += 15;
  return Math.min(100, score);
}

export async function getSmartStock(
  orgId: string,
  windowDays = DEFAULT_WINDOW_DAYS,
): Promise<{
  windowDays: number;
  items: SmartStockItem[];
  summary: {
    totalProducts: number;
    highRiskCount: number;
    deadStockCount: number;
    negativeStockCount: number;
    bestSellers: { name: string; sku: string; unitsSold: number }[];
    slowestSellers: { name: string; sku: string; unitsSold: number }[];
  };
}> {
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - windowDays);

  const orgProducts = await db.select().from(products).where(eq(products.orgId, orgId));

  const stockTotals = await db
    .select({
      productId: productLocationStock.productId,
      total: sql<number>`COALESCE(SUM(${productLocationStock.stock}), 0)::int`.as("total"),
    })
    .from(productLocationStock)
    .where(eq(productLocationStock.orgId, orgId))
    .groupBy(productLocationStock.productId);
  const stockMap = new Map(stockTotals.map((r) => [r.productId, Number(r.total) || 0]));

  const salesRows = await db
    .select({
      productUuid: orderItems.productId,
      unitsSold: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)::int`.as("units_sold"),
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(
      and(
        eq(orderItems.orgId, orgId),
        eq(orders.orgId, orgId),
        eq(orders.status, COMPLETED_STATUS),
        gte(orders.createdAt, fromDate),
      ),
    )
    .groupBy(orderItems.productId);

  const soldMap = new Map(salesRows.map((r) => [r.productUuid, Number(r.unitsSold) || 0]));

  const items: SmartStockItem[] = orgProducts.map((p) => {
    const stock = stockMap.get(p.id) ?? 0;
    const stockLimit = p.stockLimit ?? 10;
    const unitsSoldWindow = soldMap.get(p.id) ?? 0;
    const velocityPerDay = windowDays > 0 ? unitsSoldWindow / windowDays : 0;
    const deadStock = unitsSoldWindow === 0 && stock > 0;
    const anomalyNegativeStock = stock < 0;

    let daysToDepletion: number | null = null;
    let daysToDepletionLabel = "No depletion trend";
    if (unitsSoldWindow > 0 && velocityPerDay > 0 && stock > 0) {
      daysToDepletion = Math.round(stock / velocityPerDay);
      daysToDepletionLabel = `${daysToDepletion} days`;
    } else if (unitsSoldWindow === 0) {
      daysToDepletionLabel = "No depletion trend";
    } else if (stock <= 0) {
      daysToDepletionLabel = "Out of stock";
    }

    let reorderSuggestion: number | null = null;
    let reorderNote: string | null = null;
    if (velocityPerDay > 0 && daysToDepletion !== null && daysToDepletion < 14) {
      reorderSuggestion = Math.ceil(velocityPerDay * 14);
      reorderNote = `Suggested reorder: ${reorderSuggestion} units (14-day cover)`;
    } else if (stock <= 0 && velocityPerDay > 0) {
      reorderSuggestion = Math.ceil(velocityPerDay * 14);
      reorderNote = `Restock urgently: ${reorderSuggestion} units suggested`;
    }

    const riskScore = computeRiskScore(stock, stockLimit, daysToDepletion, deadStock, anomalyNegativeStock);

    return {
      productId: p.id,
      sku: p.productId,
      name: p.name,
      stock,
      stockLimit,
      unitsSoldWindow,
      velocityPerDay: Math.round(velocityPerDay * 100) / 100,
      daysToDepletion,
      daysToDepletionLabel,
      deadStock,
      reorderSuggestion,
      reorderNote,
      riskScore,
      riskLevel: riskLevelFromScore(riskScore),
      anomalyNegativeStock,
    };
  });

  items.sort((a, b) => b.riskScore - a.riskScore);

  const withSales = [...items].sort((a, b) => b.unitsSoldWindow - a.unitsSoldWindow);
  const bestSellers = withSales
    .filter((i) => i.unitsSoldWindow > 0)
    .slice(0, 5)
    .map((i) => ({ name: i.name, sku: i.sku, unitsSold: i.unitsSoldWindow }));
  const slowestSellers = withSales
    .filter((i) => i.stock > 0)
    .slice(-5)
    .reverse()
    .map((i) => ({ name: i.name, sku: i.sku, unitsSold: i.unitsSoldWindow }));

  return {
    windowDays,
    items,
    summary: {
      totalProducts: items.length,
      highRiskCount: items.filter((i) => i.riskLevel === "high" || i.riskLevel === "critical").length,
      deadStockCount: items.filter((i) => i.deadStock).length,
      negativeStockCount: items.filter((i) => i.anomalyNegativeStock).length,
      bestSellers,
      slowestSellers,
    },
  };
}

export type ActivityItem = {
  id: string;
  source: "inventory_movement" | "event" | "worker";
  entityType: string;
  entityId: string;
  title: string;
  detail: string | null;
  occurredAt: string;
  severity: "info" | "warning" | "error";
  meta?: Record<string, unknown>;
};

export async function getActivityFeed(
  orgId: string,
  filters?: {
    entityType?: string;
    entityId?: string;
    limit?: number;
    offset?: number;
  },
): Promise<{ items: ActivityItem[]; hasMore: boolean }> {
  const limit = Math.min(filters?.limit ?? 50, 100);
  const offset = filters?.offset ?? 0;
  const items: ActivityItem[] = [];

  try {
    const movements = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.orgId, orgId))
      .orderBy(desc(inventoryMovements.createdAt))
      .limit(200);

    for (const m of movements) {
      if (filters?.entityType && filters.entityType !== "inventory") continue;
      if (filters?.entityId && filters.entityId !== m.productId && filters.entityId !== m.sku) continue;
      items.push({
        id: `inv-${m.movementId}`,
        source: "inventory_movement",
        entityType: "inventory",
        entityId: m.productId ?? m.sku,
        title: `Stock ${m.delta >= 0 ? "+" : ""}${m.delta} (${m.reason})`,
        detail: m.sku,
        occurredAt: m.createdAt?.toISOString() ?? new Date().toISOString(),
        severity: m.delta < 0 ? "info" : "info",
        meta: { delta: m.delta, correlationId: m.correlationId },
      });
    }
  } catch {
    // table may be empty or missing on older DBs
  }

  try {
    const orgOrderIds = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.orgId, orgId))
      .limit(5000);
    const orderIdSet = new Set(orgOrderIds.map((o) => o.id));

    if (orderIdSet.size > 0) {
      const events = await db
        .select()
        .from(eventOutbox)
        .orderBy(desc(eventOutbox.occurredAt))
        .limit(300);

      for (const e of events) {
        if (!orderIdSet.has(e.correlationId)) continue;
        if (filters?.entityType && filters.entityType !== "order") continue;
        if (filters?.entityId && filters.entityId !== e.correlationId) continue;
        items.push({
          id: `evt-${e.eventId}`,
          source: "event",
          entityType: "order",
          entityId: e.correlationId,
          title: e.eventType,
          detail: e.source ?? null,
          occurredAt: e.occurredAt?.toISOString() ?? new Date().toISOString(),
          severity: "info",
          meta: { eventId: e.eventId, status: e.status },
        });
      }

      const logs = await db
        .select()
        .from(workerRunLogs)
        .orderBy(desc(workerRunLogs.createdAt))
        .limit(200);

      for (const log of logs) {
        if (!orderIdSet.has(log.correlationId)) continue;
        if (filters?.entityType && filters.entityType !== "worker") continue;
        if (filters?.entityId && filters.entityId !== log.correlationId) continue;
        const isFail = log.status === "failed" || log.status === "retrying";
        items.push({
          id: `wlog-${log.logId}`,
          source: "worker",
          entityType: "worker",
          entityId: log.correlationId,
          title: `${log.workerName}: ${log.status}`,
          detail: log.summary ?? log.error ?? null,
          occurredAt: log.createdAt?.toISOString() ?? new Date().toISOString(),
          severity: isFail ? "error" : "info",
          meta: { workerName: log.workerName, eventType: log.eventType },
        });
      }
    }
  } catch {
    // graceful degradation
  }

  items.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  const page = items.slice(offset, offset + limit);
  return { items: page, hasMore: items.length > offset + limit };
}

export type NotificationItem = {
  id: string;
  type: "stock" | "worker" | "approval" | "system";
  title: string;
  message: string;
  severity: "info" | "warning" | "error";
  createdAt: string;
  entityType?: string;
  entityId?: string;
  persisted?: boolean;
  readAt?: string | null;
};

export async function getNotifications(orgId: string): Promise<NotificationItem[]> {
  const notes: NotificationItem[] = [];
  const now = new Date().toISOString();

  try {
    const smart = await getSmartStock(orgId, 14);
    if (smart.summary.negativeStockCount > 0) {
      notes.push({
        id: `stock-neg-${orgId}`,
        type: "stock",
        title: "Negative stock detected",
        message: `${smart.summary.negativeStockCount} product(s) have negative stock.`,
        severity: "error",
        createdAt: now,
        entityType: "inventory",
      });
    }
    if (smart.summary.highRiskCount > 0) {
      notes.push({
        id: `stock-risk-${orgId}`,
        type: "stock",
        title: "High-risk stock items",
        message: `${smart.summary.highRiskCount} product(s) need attention.`,
        severity: "warning",
        createdAt: now,
        entityType: "inventory",
      });
    }
    const reorder = smart.items.filter((i) => i.reorderSuggestion !== null).slice(0, 3);
    for (const r of reorder) {
      notes.push({
        id: `reorder-${r.productId}`,
        type: "stock",
        title: `Reorder: ${r.name}`,
        message: r.reorderNote ?? `Suggested qty: ${r.reorderSuggestion}`,
        severity: "warning",
        createdAt: now,
        entityType: "product",
        entityId: r.productId,
      });
    }
  } catch {
    // ignore
  }

  try {
    const pending = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(userApprovalRequests)
      .where(eq(userApprovalRequests.status, "pending"));
    const count = pending[0]?.count ?? 0;
    if (count > 0) {
      notes.push({
        id: `approval-pending-${orgId}`,
        type: "approval",
        title: "Pending user approvals",
        message: `${count} user(s) awaiting approval.`,
        severity: "info",
        createdAt: now,
        entityType: "user",
      });
    }
  } catch {
    // ignore
  }

  try {
    const dead = await db.select().from(deadLetters).orderBy(desc(deadLetters.failedAt)).limit(5);
    for (const d of dead.slice(0, 3)) {
      notes.push({
        id: `dl-${d.deadLetterId}`,
        type: "worker",
        title: "Worker dead letter",
        message: `${d.workerName} failed permanently.`,
        severity: "error",
        createdAt: d.failedAt?.toISOString() ?? now,
        entityType: "worker",
        entityId: d.eventId,
      });
    }
  } catch {
    // ignore
  }

  try {
    const orgNs = await db
      .select()
      .from(orgNotifications)
      .where(eq(orgNotifications.orgId, orgId))
      .orderBy(desc(orgNotifications.createdAt))
      .limit(40);
    for (const n of orgNs) {
      notes.push({
        id: n.id,
        type: "system",
        title: n.title,
        message: n.message,
        severity: (n.severity as "info" | "warning" | "error") || "info",
        createdAt: n.createdAt?.toISOString() ?? now,
        entityType: n.source,
        persisted: true,
        readAt: n.readAt?.toISOString() ?? null,
      });
    }
  } catch {
    // ignore
  }

  return notes.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export async function getBusinessHealth(orgId: string): Promise<{
  revenueToday: number;
  revenueRange: number;
  revenueTrend: { date: string; revenue: number }[];
  orderCountToday: number;
  orderCountRange: number;
  averageOrderValue: number;
  highRiskStockCount: number;
  deadStockCount: number;
  pendingApprovals: number;
  workerHealth: { queued: number; failed: number; deadLetter: number; status: string };
  topProduct: { name: string; unitsSold: number } | null;
  newCustomers: number;
  rangeDays: number;
}> {
  const rangeDays = 7;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const rangeStart = new Date();
  rangeStart.setDate(rangeStart.getDate() - rangeDays);

  let revenueToday = 0;
  let revenueRange = 0;
  const revenueTrend: { date: string; revenue: number }[] = [];

  try {
    const todayOrders = await db
      .select({ total: sql<number>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL)), 0)` })
      .from(orders)
      .where(
        and(
          eq(orders.orgId, orgId),
          eq(orders.status, COMPLETED_STATUS),
          gte(orders.createdAt, todayStart),
        ),
      );
    revenueToday = Number(todayOrders[0]?.total) || 0;

    const rangeOrders = await db
      .select({ total: sql<number>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL)), 0)` })
      .from(orders)
      .where(
        and(
          eq(orders.orgId, orgId),
          eq(orders.status, COMPLETED_STATUS),
          gte(orders.createdAt, rangeStart),
        ),
      );
    revenueRange = Number(rangeOrders[0]?.total) || 0;

    const rangeDateStr = rangeStart.toISOString().slice(0, 10);
    const daily = await db
      .select()
      .from(analyticsDaily)
      .where(and(eq(analyticsDaily.orgId, orgId), gte(analyticsDaily.date, rangeDateStr)))
      .orderBy(analyticsDaily.date)
      .limit(rangeDays + 1);

    if (daily.length > 0) {
      for (const d of daily) {
        revenueTrend.push({
          date: String(d.date),
          revenue: Number(d.totalRevenue) || 0,
        });
      }
    } else {
      const byDay = await db
        .select({
          day: sql<string>`DATE(${orders.createdAt})`.as("day"),
          revenue: sql<number>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL)), 0)`.as("rev"),
        })
        .from(orders)
        .where(
          and(
            eq(orders.orgId, orgId),
            eq(orders.status, COMPLETED_STATUS),
            gte(orders.createdAt, rangeStart),
          ),
        )
        .groupBy(sql`DATE(${orders.createdAt})`)
        .orderBy(sql`DATE(${orders.createdAt})`);
      for (const row of byDay) {
        revenueTrend.push({ date: String(row.day), revenue: Number(row.revenue) || 0 });
      }
    }
  } catch {
    // fallback zeros
  }

  const orderCountTodayRow = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(eq(orders.orgId, orgId), gte(orders.createdAt, todayStart)));
  const orderCountRangeRow = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(eq(orders.orgId, orgId), gte(orders.createdAt, rangeStart)));
  const orderCountToday = orderCountTodayRow[0]?.c ?? 0;
  const orderCountRange = orderCountRangeRow[0]?.c ?? 0;
  const averageOrderValue =
    orderCountRange > 0 ? Math.round((revenueRange / orderCountRange) * 100) / 100 : 0;

  let highRiskStockCount = 0;
  let deadStockCount = 0;
  try {
    const smart = await getSmartStock(orgId, 30);
    highRiskStockCount = smart.summary.highRiskCount;
    deadStockCount = smart.summary.deadStockCount;
  } catch {
    // ignore
  }

  let pendingApprovals = 0;
  try {
    const p = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(userApprovalRequests)
      .where(eq(userApprovalRequests.status, "pending"));
    pendingApprovals = p[0]?.c ?? 0;
  } catch {
    // ignore
  }

  let workerHealth = { queued: 0, failed: 0, deadLetter: 0, status: "healthy" as string };
  try {
    const stats = await getJobQueueStats();
    const dead = await db.select({ c: sql<number>`count(*)::int` }).from(deadLetters);
    workerHealth = {
      queued: stats.queued,
      failed: stats.failed,
      deadLetter: dead[0]?.c ?? stats.deadLetter,
      status:
        (dead[0]?.c ?? 0) > 0 || stats.failed > 5
          ? "degraded"
          : stats.queued > 50
            ? "busy"
            : "healthy",
    };
  } catch {
    workerHealth.status = "unknown";
  }

  let topProduct: { name: string; unitsSold: number } | null = null;
  try {
    const smart = await getSmartStock(orgId, 30);
    if (smart.summary.bestSellers[0]) {
      topProduct = {
        name: smart.summary.bestSellers[0].name,
        unitsSold: smart.summary.bestSellers[0].unitsSold,
      };
    }
  } catch {
    // ignore
  }

  let newCustomers = 0;
  try {
    const nc = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(customers)
      .where(and(eq(customers.orgId, orgId), gte(customers.createdAt, rangeStart)));
    newCustomers = nc[0]?.c ?? 0;
  } catch {
    // ignore
  }

  return {
    revenueToday,
    revenueRange,
    revenueTrend,
    orderCountToday,
    orderCountRange,
    averageOrderValue,
    highRiskStockCount,
    deadStockCount,
    pendingApprovals,
    workerHealth,
    topProduct,
    newCustomers,
    rangeDays,
  };
}
