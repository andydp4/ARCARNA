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

export function registerPromotionRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/promotions", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const activeOnly = req.query.active === 'true';
      const promotions = await storage.getPromotions(ctx.orgId, activeOnly);
      res.json(promotions);
    } catch (error) {
      console.error("Error fetching promotions:", error);
      res.status(500).json({ message: "Failed to fetch promotions" });
    }
  });

  app.post("/api/promotions", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const validatedData = insertPromotionSchema.parse({ ...req.body, orgId: ctx.orgId });
      const promo = await storage.createPromotion(validatedData);
      res.json(promo);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        res.status(400).json({ message: "Invalid data", errors: error.errors });
      } else {
        console.error("Error creating promotion:", error);
        res.status(500).json({ message: "Failed to create promotion" });
      }
    }
  });

  app.patch("/api/promotions/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { id } = req.params;
      const validatedData = insertPromotionSchema.partial().parse(req.body);
      const promo = await storage.updatePromotion(id, validatedData, ctx.orgId);
      res.json(promo);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        res.status(400).json({ message: "Invalid data", errors: error.errors });
      } else {
        console.error("Error updating promotion:", error);
        res.status(500).json({ message: "Failed to update promotion" });
      }
    }
  });

  app.delete("/api/promotions/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { id } = req.params;
      await storage.deletePromotion(id, ctx.orgId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting promotion:", error);
      res.status(500).json({ message: "Failed to delete promotion" });
    }
  });

  app.post("/api/promotions/validate", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { code } = req.body;
      const promo = await storage.validatePromoCode(code, ctx.orgId);
      if (promo) {
        res.json(promo);
      } else {
        res.status(404).json({ message: "Invalid or expired promo code" });
      }
    } catch (error) {
      console.error("Error validating promo code:", error);
      res.status(500).json({ message: "Failed to validate promo code" });
    }
  });

}
