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

export function registerLoyaltyRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/loyalty-tiers", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const tiers = await storage.getLoyaltyTiers(ctx.orgId);
      res.json(tiers);
    } catch (error) {
      console.error("Error fetching loyalty tiers:", error);
      res.status(500).json({ message: "Failed to fetch loyalty tiers" });
    }
  });

  app.post("/api/loyalty-tiers", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const validatedData = insertLoyaltyTierSchema.parse({ ...req.body, orgId: ctx.orgId });
      const tier = await storage.createLoyaltyTier(validatedData);
      res.json(tier);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        res.status(400).json({ message: "Invalid data", errors: error.errors });
      } else {
        console.error("Error creating loyalty tier:", error);
        res.status(500).json({ message: "Failed to create loyalty tier" });
      }
    }
  });

  app.patch("/api/loyalty-tiers/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { id } = req.params;
      const validatedData = insertLoyaltyTierSchema.partial().parse(req.body);
      const tier = await storage.updateLoyaltyTier(id, validatedData, ctx.orgId);
      res.json(tier);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        res.status(400).json({ message: "Invalid data", errors: error.errors });
      } else {
        console.error("Error updating loyalty tier:", error);
        res.status(500).json({ message: "Failed to update loyalty tier" });
      }
    }
  });

  app.delete("/api/loyalty-tiers/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { id } = req.params;
      await storage.deleteLoyaltyTier(id, ctx.orgId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting loyalty tier:", error);
      res.status(500).json({ message: "Failed to delete loyalty tier" });
    }
  });

}
