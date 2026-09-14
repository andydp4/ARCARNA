import type { Express, RequestHandler } from "express";
import { AmbiguousStockLocationError, storage } from "../storage";
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
import { resolveEditableStockLocationId } from "../services/stockLocationContext";
import { StockError, stockErrorPayload, resolveStockLocationId } from "../services/productLocationStock";

/**
 * Roles allowed to look at a location other than their own resolved one —
 * same bar as the page itself (client/src/components/nav-items.ts's
 * MANAGER_ROLES gates the /inventory route this serves).
 */
const CAN_VIEW_ANY_LOCATION = new Set(["SUPER_ADMIN", "ADMIN", "MANAGER"]);

export function registerInventoryRoutes(app: Express, scoped: RequestHandler[]): void {
  // ARC-042: a goods receipt into a location other than the caller's own
  // resolved one was always correct in product_location_stock, but nothing
  // in the UI could ever show it — this endpoint only ever answered with
  // whichever single location resolved from the caller's own context.
  // `?locationId=` lets a MANAGER+ explicitly look at any of the org's
  // locations (or `all` for the org-wide total); every other caller keeps
  // the existing resolved-own-location behaviour unchanged.
  app.get("/api/inventory", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const requestedLocationId =
        typeof req.query.locationId === "string" && req.query.locationId.length > 0
          ? req.query.locationId
          : undefined;

      let stockLocationId: string | null;
      if (requestedLocationId && CAN_VIEW_ANY_LOCATION.has(ctx.role)) {
        if (requestedLocationId === "all") {
          // Explicit org-wide total across every location.
          stockLocationId = null;
        } else {
          try {
            stockLocationId = await resolveStockLocationId({
              orgId: ctx.orgId,
              locationId: requestedLocationId,
            });
          } catch (error) {
            if (error instanceof StockError && error.code === "LOCATION_NOT_FOUND") {
              return res.status(404).json(stockErrorPayload(error));
            }
            throw error;
          }
        }
      } else {
        stockLocationId = await resolveEditableStockLocationId({
          orgId: ctx.orgId,
          locationId: ctx.locationId,
          userId: req.user?.claims?.sub ?? req.user?.id ?? null,
        });
      }

      const list = await storage.getProductsWithStock(ctx.orgId, stockLocationId);
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
      const stockLocationId =
        locationId ??
        (await resolveEditableStockLocationId({
          orgId: ctx.orgId,
          locationId: ctx.locationId,
          userId,
        }));
      const product = await storage.updateProductStock(
        productId,
        adjustment,
        type,
        userId,
        ctx.orgId,
        stockLocationId ?? undefined,
      );
      res.json(product);
    } catch (error) {
      console.error("Error updating inventory:", error);
      if (error instanceof AmbiguousStockLocationError) {
        return res.status(400).json({
          code: "LOCATION_REQUIRED",
          message: error.message,
        });
      }
      if (error instanceof StockError) {
        return res.status(400).json(stockErrorPayload(error));
      }
      res.status(500).json({ message: "Failed to update inventory" });
    }
  });

  // Low stock alerts endpoint
  app.get("/api/inventory/alerts", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const stockLocationId = await resolveEditableStockLocationId({
        orgId: ctx.orgId,
        locationId: ctx.locationId,
        userId: req.user?.claims?.sub ?? req.user?.id ?? null,
      });
      const products = await storage.getProductsWithStock(ctx.orgId, stockLocationId);
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
