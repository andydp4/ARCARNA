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

export function registerInventoryRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/inventory", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const list = await storage.getProductsWithStock(ctx.orgId);
      res.json(list);
    } catch (error) {
      console.error("Error fetching inventory:", error);
      res.status(500).json({ message: "Failed to fetch inventory" });
    }
  });

  app.patch("/api/inventory/:productId", ...scoped, requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER'), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId?: string | null };
      const { productId } = req.params;
      const { adjustment, type, locationId } = req.body;
      const userId = req.user.claims.sub;
      const product = await storage.updateProductStock(
        productId,
        adjustment,
        type,
        userId,
        ctx.orgId,
        locationId ?? ctx.locationId ?? undefined,
      );
      res.json(product);
    } catch (error) {
      console.error("Error updating inventory:", error);
      res.status(500).json({ message: "Failed to update inventory" });
    }
  });

  // Low stock alerts endpoint
  app.get("/api/inventory/alerts", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const products = await storage.getProductsWithStock(ctx.orgId);
      const alerts = products
        .filter(product => {
          if (product.stock == null || product.stockLimit == null) return false;
          const stockPercentage = (product.stock / product.stockLimit) * 100;
          return product.stock <= product.stockLimit && stockPercentage <= 30;
        })
        .map(product => ({
          ...product,
          alertLevel: product.stock === 0 ? 'critical' : 
                      ((product.stock || 0) / (product.stockLimit || 1)) * 100 <= 10 ? 'high' : 
                      'medium',
          stockPercentage: ((product.stock || 0) / (product.stockLimit || 1)) * 100
        }))
        .sort((a, b) => a.stockPercentage - b.stockPercentage);
      
      res.json({
        alerts,
        summary: {
          critical: alerts.filter(a => a.alertLevel === 'critical').length,
          high: alerts.filter(a => a.alertLevel === 'high').length,
          medium: alerts.filter(a => a.alertLevel === 'medium').length,
          total: alerts.length
        }
      });
    } catch (error) {
      console.error("Error fetching inventory alerts:", error);
      res.status(500).json({ message: "Failed to fetch inventory alerts" });
    }
  });

}
