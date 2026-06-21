import type { Express, RequestHandler } from "express";
import { z } from "zod";
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
import {
  getLoyaltySettings,
  upsertLoyaltySettings,
  validatePointsRedemption,
} from "../lib/loyaltyRedemptionService";

const settingsSchema = z.object({
  redemptionRate: z.coerce.number().positive().max(1).optional(),
  minRedeemPoints: z.coerce.number().int().min(1).optional(),
});

const redeemPreviewSchema = z.object({
  customerId: z.string().uuid(),
  points: z.coerce.number().int().positive(),
});

export function registerLoyaltyRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/loyalty/settings", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; role: string };
      res.json(await getLoyaltySettings(ctx.orgId));
    } catch (error) {
      console.error("Error fetching loyalty settings:", error);
      res.status(500).json({ message: "Failed to fetch loyalty settings" });
    }
  });

  app.put("/api/loyalty/settings", ...scoped, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; role: string };
      const body = settingsSchema.parse(req.body);
      const settings = await upsertLoyaltySettings(ctx.orgId, body);
      await recordAdminAudit(req, {
        actorUserId: req.user?.id ?? "unknown",
        actorRole: ctx.role ?? "MANAGER",
        action: "loyalty.settings.update",
        targetType: "organization",
        targetId: ctx.orgId,
        orgId: ctx.orgId,
        metadata: settings,
      });
      res.json(settings);
    } catch (error: any) {
      if (error.name === "ZodError") return res.status(400).json({ message: "Invalid data", errors: error.errors });
      console.error("Error updating loyalty settings:", error);
      res.status(500).json({ message: "Failed to update loyalty settings" });
    }
  });

  app.post("/api/loyalty/redeem-preview", ...scoped, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; role: string };
      const body = redeemPreviewSchema.parse(req.body);
      const result = await validatePointsRedemption(ctx.orgId, body.customerId, body.points);
      res.json(result);
    } catch (error: any) {
      const message = error.message || "Redemption preview failed";
      res.status(400).json({ message });
    }
  });

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
      if ((error as any)?.code === '23503') return res.status(409).json({ message: "Cannot delete this loyalty tier: it is still referenced by customers or promotions. Archive or deactivate it instead." });
      res.status(500).json({ message: "Failed to delete loyalty tier" });
    }
  });

}
