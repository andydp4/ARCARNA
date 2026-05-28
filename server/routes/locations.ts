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

export function registerLocationRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/locations", ...scoped, requireRole('SUPER_ADMIN', 'ADMIN'), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const locations = await storage.getLocations(ctx.orgId);
      res.json(locations);
    } catch (error) {
      console.error("Error fetching locations:", error);
      res.status(500).json({ message: "Failed to fetch locations" });
    }
  });

  app.post("/api/locations", ...scoped, requireRole('SUPER_ADMIN', 'ADMIN'), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const locationData = { ...req.body, orgId: ctx.orgId };
      const location = await storage.createLocation(locationData);
      res.json(location);
    } catch (error) {
      console.error("Error creating location:", error);
      res.status(500).json({ message: "Failed to create location" });
    }
  });

  app.patch("/api/locations/:id", ...scoped, requireRole('SUPER_ADMIN', 'ADMIN'), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { id } = req.params;
      const location = await storage.updateLocation(id, req.body, ctx.orgId);
      res.json(location);
    } catch (error) {
      console.error("Error updating location:", error);
      res.status(500).json({ message: "Failed to update location" });
    }
  });

  app.delete("/api/locations/:id", ...scoped, requireRole('SUPER_ADMIN', 'ADMIN'), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { id } = req.params;
      await storage.deleteLocation(id, ctx.orgId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting location:", error);
      res.status(500).json({ message: "Failed to delete location" });
    }
  });

  app.post("/api/locations/:id/set-default", ...scoped, requireRole('SUPER_ADMIN', 'ADMIN'), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { id } = req.params;
      const location = await storage.setDefaultLocation(id, ctx.orgId);
      res.json(location);
    } catch (error) {
      console.error("Error setting default location:", error);
      res.status(500).json({ message: "Failed to set default location" });
    }
  });

  app.get("/api/locations/:id/stock", ...scoped, requireRole('SUPER_ADMIN', 'ADMIN'), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { db } = await import('../db');
      const { products, locations } = await import('@shared/schema');
      const { eq, and, desc } = await import('drizzle-orm');
      if (ctx?.orgId) {
        const [loc] = await db.select().from(locations).where(and(eq(locations.id, req.params.id), eq(locations.orgId, ctx.orgId)));
        if (!loc) return res.status(404).json({ message: 'Location not found' });
      }
      const prodCond = ctx?.orgId ? eq(products.orgId, ctx.orgId) : undefined;
      const allProducts = prodCond
        ? await db.select({ id: products.id, name: products.name, productCode: products.productId, stock: products.stock, salePrice: products.defaultSalePrice, costPrice: products.costPrice }).from(products).where(prodCond).orderBy(desc(products.stock))
        : await db.select({ id: products.id, name: products.name, productCode: products.productId, stock: products.stock, salePrice: products.defaultSalePrice, costPrice: products.costPrice }).from(products).orderBy(desc(products.stock));
      
      const stockSummary = {
        totalProducts: allProducts.length,
        totalStock: allProducts.reduce((sum, p) => sum + (p.stock || 0), 0),
        lowStock: allProducts.filter(p => (p.stock || 0) <= 20 && (p.stock || 0) > 5).length,
        criticalStock: allProducts.filter(p => (p.stock || 0) <= 5).length,
        outOfStock: allProducts.filter(p => (p.stock || 0) === 0).length,
      };
      
      res.json({
        locationId: req.params.id,
        products: allProducts,
        summary: stockSummary,
      });
    } catch (error) {
      console.error("Error fetching location stock:", error);
      res.status(500).json({ message: "Failed to fetch stock levels" });
    }
  });

}
