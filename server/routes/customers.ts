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
import { handleBulkAction, rowsToCsv } from "../lib/bulkActionHandler";

export function registerCustomerRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/customers/intelligence", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      if (!ctx?.orgId) {
        return res.status(400).json({ message: "Org context required for customer intelligence" });
      }
      const { listCustomerIntelligence } = await import("../services/customerIntelligence");
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 200);
      const items = await listCustomerIntelligence(ctx.orgId, limit);
      res.json({ items });
    } catch (error) {
      console.error("Error listing customer intelligence:", error);
      res.status(500).json({ message: "Failed to list customer intelligence" });
    }
  });

  app.get("/api/customers", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const list = await storage.getCustomers(ctx.orgId);
      res.json(list);
    } catch (error) {
      console.error("Error fetching customers:", error);
      res.status(500).json({ message: "Failed to fetch customers" });
    }
  });

  app.get("/api/customers/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const customer = await storage.getCustomer(req.params.id, ctx.orgId);
      if (!customer) {
        return res.status(404).json({ message: "Customer not found" });
      }
      res.json(customer);
    } catch (error) {
      console.error("Error fetching customer:", error);
      res.status(500).json({ message: "Failed to fetch customer" });
    }
  });

  app.get("/api/customers/:id/intelligence", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      if (!ctx?.orgId) {
        return res.status(400).json({ message: "Org context required for customer intelligence" });
      }
      const { computeCustomerIntelligence } = await import("../services/customerIntelligence");
      const intel = await computeCustomerIntelligence(ctx.orgId, req.params.id);
      if (!intel) return res.status(404).json({ message: "Customer not found" });
      res.json(intel);
    } catch (error) {
      console.error("Error fetching customer intelligence:", error);
      res.status(500).json({ message: "Failed to fetch customer intelligence" });
    }
  });

  app.post("/api/customers", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { engine } = await import('../../apps/server/src/engine.wiring');
      const customer = await engine.createCustomer({ ...req.body, orgId: ctx.orgId });
      res.json(customer);
    } catch (error) {
      console.error("Error creating customer:", error);
      res.status(500).json({ message: "Failed to create customer" });
    }
  });

  app.put("/api/customers/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const existing = await storage.getCustomer(req.params.id, ctx.orgId);
      if (!existing) return res.status(404).json({ message: "Customer not found" });
      const { engine } = await import('../../apps/server/src/engine.wiring');
      const customer = await engine.updateCustomer(req.params.id, req.body, ctx.orgId);
      res.json(customer);
    } catch (error: any) {
      console.error("Error updating customer:", error);
      if (error?.message === 'Customer not found') return res.status(404).json({ message: "Customer not found" });
      res.status(500).json({ message: "Failed to update customer" });
    }
  });

  app.delete("/api/customers/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const existing = await storage.getCustomer(req.params.id, ctx.orgId);
      if (!existing) return res.status(404).json({ message: "Customer not found" });
      const { engine } = await import('../../apps/server/src/engine.wiring');
      await engine.deleteCustomer(req.params.id, ctx.orgId);
      res.json({ message: "Customer deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting customer:", error);
      if (error?.message === 'Customer not found') return res.status(404).json({ message: "Customer not found" });
      res.status(500).json({ message: "Failed to delete customer" });
    }
  });

  app.post("/api/customers/bulk", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; role: Role };
      const outcome = await handleBulkAction(req, "customers", {
        orgId: ctx.orgId,
        role: ctx.role,
        userId: req.user?.id,
      });
      if (!outcome.ok) return res.status(outcome.status).json({ message: outcome.message });
      const result = outcome.result as { format?: string; rows?: Record<string, unknown>[] };
      if (result.format === "csv" && result.rows) {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", 'attachment; filename="customers-export.csv"');
        return res.send(rowsToCsv(result.rows));
      }
      res.json(outcome.result);
    } catch (error: any) {
      console.error("Error in customer bulk action:", error);
      res.status(500).json({ message: error.message || "Bulk action failed" });
    }
  });

}
