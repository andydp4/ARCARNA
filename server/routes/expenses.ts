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

export function registerExpenseRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/overhead-expenses", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const expenses = await storage.getOverheadExpenses(ctx.orgId);
      res.json(expenses);
    } catch (error) {
      console.error("Error fetching overhead expenses:", error);
      res.status(500).json({ message: "Failed to fetch overhead expenses" });
    }
  });

  app.post("/api/overhead-expenses", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const parsedBody = insertOverheadExpenseSchema.parse({ ...req.body, orgId: ctx.orgId });
      const expense = await storage.createOverheadExpense(parsedBody);
      res.json(expense);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        res.status(400).json({ message: 'Validation error', details: error.errors });
      } else {
        console.error("Error creating overhead expense:", error);
        res.status(500).json({ message: "Failed to create overhead expense" });
      }
    }
  });

  app.put("/api/overhead-expenses/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const parsedBody = insertOverheadExpenseSchema.partial().parse(req.body);
      const expense = await storage.updateOverheadExpense(req.params.id, parsedBody, ctx.orgId);
      res.json(expense);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        res.status(400).json({ message: 'Validation error', details: error.errors });
      } else {
        console.error("Error updating overhead expense:", error);
        res.status(500).json({ message: "Failed to update overhead expense" });
      }
    }
  });

  app.delete("/api/overhead-expenses/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      await storage.deleteOverheadExpense(req.params.id, ctx.orgId);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting overhead expense:", error);
      res.status(500).json({ message: "Failed to delete overhead expense" });
    }
  });

  app.get("/api/orders/:orderId/expenses", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const expenses = await storage.getOrderExpenses(req.params.orderId, ctx.orgId);
      res.json(expenses);
    } catch (error) {
      console.error("Error fetching order expenses:", error);
      res.status(500).json({ message: "Failed to fetch order expenses" });
    }
  });

  app.get("/api/expense-analytics", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const startDate = new Date(req.query.startDate as string);
      const endDate = new Date(req.query.endDate as string);
      
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        res.status(400).json({ message: 'Invalid date format' });
        return;
      }
      
      const analytics = await storage.getExpenseAnalytics(startDate, endDate, ctx.orgId);
      res.json(analytics);
    } catch (error) {
      console.error("Error fetching expense analytics:", error);
      res.status(500).json({ message: "Failed to fetch expense analytics" });
    }
  });

  app.get("/api/expense-report", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const startDate = new Date(req.query.startDate as string);
      const endDate = new Date(req.query.endDate as string);
      
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        res.status(400).json({ message: 'Invalid date format' });
        return;
      }
      
      const report = await storage.getExpenseReport(startDate, endDate, ctx.orgId);
      res.json(report);
    } catch (error) {
      console.error("Error fetching expense report:", error);
      res.status(500).json({ message: "Failed to fetch expense report" });
    }
  });

  app.get("/api/profit-analysis", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const startDate = new Date(req.query.startDate as string);
      const endDate = new Date(req.query.endDate as string);
      
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        res.status(400).json({ message: 'Invalid date format' });
        return;
      }
      
      const analysis = await storage.getProfitAnalysis(startDate, endDate, ctx.orgId);
      res.json(analysis);
    } catch (error) {
      console.error("Error fetching profit analysis:", error);
      res.status(500).json({ message: "Failed to fetch profit analysis" });
    }
  });

}
