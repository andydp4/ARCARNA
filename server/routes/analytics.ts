import type { Express, RequestHandler } from "express";
import { format } from "date-fns";
import { storage } from "../storage";
import type { DailyKpiResponse } from "@shared/analytics/kpi";
import { RFM_SEGMENTS, type RfmSegment } from "@shared/analytics/rfm";
import { getDailyKpi } from "../services/dailyKpi";
import { getHourOfDayAnalytics } from "../services/hourOfDayService";
import { getStockTurnAnalytics } from "../services/stockTurnService";
import { getRfmCustomersBySegment, getRfmSummary, recomputeOrgRfm } from "../lib/rfmService";
import { requireRole } from "../auth";

type KpiCacheEntry = { payload: DailyKpiResponse; expiresAt: number };

const KPI_CACHE_TTL_MS = 60_000;
const HOD_CACHE_TTL_MS = 5 * 60_000;
const STOCK_TURN_CACHE_TTL_MS = 5 * 60_000;
const kpiCache = new Map<string, KpiCacheEntry>();
const hodCache = new Map<string, { payload: unknown; expiresAt: number }>();
const stockTurnCache = new Map<string, { payload: unknown; expiresAt: number }>();

function kpiCacheKey(orgId: string, date: string): string {
  return `${orgId}:${date}`;
}

function isValidDateParam(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

export function registerAnalyticsRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/analytics/top-customers", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const limit = parseInt(req.query.limit as string) || 10;
      const topCustomers = await storage.getTopCustomers(limit, ctx.orgId);
      
      const formattedCustomers = topCustomers.map(({ customer, metrics }) => ({
        id: customer.id,
        name: customer.name,
        email: customer.email,
        orderCount: metrics?.orderCount || 0,
        totalSpent: metrics?.totalSpent || "0",
        rfmScore: metrics?.rfmScore || 0,
        clv: metrics?.clv || "0",
        lastOrderDate: metrics?.lastOrderDate || null,
        category: customer.category || "Bronze",
      }));

      res.json(formattedCustomers);
    } catch (error) {
      console.error("Error fetching top customers:", error);
      res.status(500).json({ message: "Failed to fetch top customers" });
    }
  });

  app.get("/api/analytics/daily-revenue", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const days = parseInt(req.query.days as string) || 30;
      const dailyRevenue = await storage.getDailyRevenue(days, ctx.orgId);
      res.json(dailyRevenue);
    } catch (error) {
      console.error("Error fetching daily revenue:", error);
      res.status(500).json({ message: "Failed to fetch daily revenue" });
    }
  });

  app.get("/api/analytics/monthly-summary", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const months = parseInt(req.query.months as string) || 12;
      const monthlySummary = await storage.getMonthlySummary(months, ctx.orgId);
      res.json(monthlySummary);
    } catch (error) {
      console.error("Error fetching monthly summary:", error);
      res.status(500).json({ message: "Failed to fetch monthly summary" });
    }
  });

  app.get("/api/analytics/kpi/daily", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const rawDate = typeof req.query.date === "string" ? req.query.date : "";
      const date = rawDate && isValidDateParam(rawDate)
        ? rawDate
        : format(new Date(), "yyyy-MM-dd");

      const cacheKey = kpiCacheKey(ctx.orgId, date);
      const hit = kpiCache.get(cacheKey);
      if (hit && hit.expiresAt > Date.now()) {
        res.json(hit.payload);
        return;
      }

      const payload = await getDailyKpi(ctx.orgId, date);
      kpiCache.set(cacheKey, { payload, expiresAt: Date.now() + KPI_CACHE_TTL_MS });
      res.json(payload);
    } catch (error) {
      console.error("Error fetching daily KPI:", error);
      res.status(500).json({ message: "Failed to fetch daily KPI" });
    }
  });

  app.get("/api/analytics/rfm", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      let summary = await getRfmSummary(ctx.orgId);
      if (summary.totalCustomers === 0) {
        await recomputeOrgRfm(ctx.orgId);
        summary = await getRfmSummary(ctx.orgId);
      }
      res.json(summary);
    } catch (error) {
      console.error("Error fetching RFM summary:", error);
      res.status(500).json({ message: "Failed to fetch RFM analytics" });
    }
  });

  app.get("/api/analytics/rfm/customers", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const segment = String(req.query.segment || "") as RfmSegment;
      if (!RFM_SEGMENTS.includes(segment)) {
        return res.status(400).json({ message: "Invalid segment" });
      }
      const limit = Math.min(parseInt(String(req.query.limit || "50"), 10) || 50, 200);
      const offset = parseInt(String(req.query.offset || "0"), 10) || 0;
      const customers = await getRfmCustomersBySegment(ctx.orgId, segment, limit, offset);
      res.json({ segment, customers, limit, offset });
    } catch (error) {
      console.error("Error fetching RFM customers:", error);
      res.status(500).json({ message: "Failed to fetch RFM customers" });
    }
  });

  app.get("/api/analytics/rfm/export", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const segment = String(req.query.segment || "") as RfmSegment;
      if (!RFM_SEGMENTS.includes(segment)) {
        return res.status(400).json({ message: "Invalid segment" });
      }
      const rows = await getRfmCustomersBySegment(ctx.orgId, segment, 5000, 0);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="rfm-${segment.toLowerCase()}.csv"`);
      res.write("customer_id,name,email,segment,r,f,m,total_spent,loyalty_points\n");
      for (const row of rows) {
        const line = [
          row.customerId,
          `"${(row.name || "").replace(/"/g, '""')}"`,
          row.email || "",
          row.segment,
          row.recencyScore,
          row.frequencyScore,
          row.monetaryScore,
          row.totalSpent,
          row.loyaltyPoints,
        ].join(",");
        res.write(line + "\n");
      }
      res.end();
    } catch (error) {
      console.error("Error exporting RFM CSV:", error);
      res.status(500).json({ message: "Failed to export RFM CSV" });
    }
  });

  app.post("/api/analytics/rfm/recompute", ...scoped, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const count = await recomputeOrgRfm(ctx.orgId);
      res.json({ success: true, customersScored: count });
    } catch (error) {
      console.error("Error recomputing RFM:", error);
      res.status(500).json({ message: "Failed to recompute RFM" });
    }
  });

  app.get("/api/analytics/hour-of-day", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const weeks = Math.min(parseInt(String(req.query.weeks || "12"), 10) || 12, 52);
      const cacheKey = `${ctx.orgId}:${weeks}`;
      const hit = hodCache.get(cacheKey);
      if (hit && hit.expiresAt > Date.now()) {
        res.json(hit.payload);
        return;
      }
      const payload = await getHourOfDayAnalytics(ctx.orgId, weeks);
      hodCache.set(cacheKey, { payload, expiresAt: Date.now() + HOD_CACHE_TTL_MS });
      res.json(payload);
    } catch (error) {
      console.error("Error fetching hour-of-day analytics:", error);
      res.status(500).json({ message: "Failed to fetch hour-of-day analytics" });
    }
  });

  app.get("/api/analytics/stock-turn", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const windowDays = Math.min(parseInt(String(req.query.windowDays || "90"), 10) || 90, 365);
      const cacheKey = `${ctx.orgId}:${windowDays}`;
      const hit = stockTurnCache.get(cacheKey);
      if (hit && hit.expiresAt > Date.now()) {
        res.json(hit.payload);
        return;
      }
      const payload = await getStockTurnAnalytics(ctx.orgId, windowDays);
      stockTurnCache.set(cacheKey, { payload, expiresAt: Date.now() + STOCK_TURN_CACHE_TTL_MS });
      res.json(payload);
    } catch (error) {
      console.error("Error fetching stock turn:", error);
      res.status(500).json({ message: "Failed to fetch stock turn analytics" });
    }
  });

}
