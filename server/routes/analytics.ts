import type { Express, RequestHandler } from "express";
import { storage } from "../storage";
import { isAuthenticated, isOwner, requireRole, requireOrgContext, requireOrgScope, requireSuperAdminMfa } from "../auth";
import { getAuthRuntimeSnapshot, getAuthProvider } from "../authRuntime";
import { canAssignRole, canManageUser, isRole } from "@shared/rbac";
import type { Role } from "@shared/schema";
import { recordAdminAudit } from "../adminAudit";
import {
  insertLoyaltyTierSchema,
  insertPromotionSchema,
  insertOrderSchema,
  insertCustomerSchema,
  insertProductSchema,
  insertOverheadExpenseSchema,
  insertOrderExpenseSchema,
} from "@shared/schema";

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

}
