import type { Express, RequestHandler } from "express";
import { format } from "date-fns";
import { storage } from "../storage";
import type { DailyKpiResponse } from "@shared/analytics/kpi";
import { getDailyKpi } from "../services/dailyKpi";

type KpiCacheEntry = { payload: DailyKpiResponse; expiresAt: number };

const KPI_CACHE_TTL_MS = 60_000;
const kpiCache = new Map<string, KpiCacheEntry>();

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

}
