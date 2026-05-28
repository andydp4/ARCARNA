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

export function registerProductRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/products", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const list = await storage.getProducts(ctx.orgId);
      res.json(list);
    } catch (error) {
      console.error("Error fetching products:", error);
      res.status(500).json({ message: "Failed to fetch products" });
    }
  });

  app.get("/api/products/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const product = await storage.getProduct(req.params.id, ctx.orgId);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      res.json(product);
    } catch (error) {
      console.error("Error fetching product:", error);
      res.status(500).json({ message: "Failed to fetch product" });
    }
  });

  app.post("/api/products", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { engine } = await import('../../apps/server/src/engine.wiring');
      const product = await engine.createProduct({ ...req.body, orgId: ctx.orgId });
      res.json(product);
    } catch (error: any) {
      console.error("Error creating product:", error);
      
      // Check for duplicate product code error
      if (error.message?.includes('duplicate key') || error.message?.includes('unique constraint') || error.code === '23505') {
        return res.status(400).json({ 
          message: `Product code "${req.body.productCode}" already exists. Please use a different code.` 
        });
      }
      
      // Check for validation errors
      if (error.message?.includes('required') || error.message?.includes('invalid')) {
        return res.status(400).json({ message: error.message });
      }
      
      // Generic error
      res.status(500).json({ message: error.message || "Failed to create product" });
    }
  });

  app.put("/api/products/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const existing = await storage.getProduct(req.params.id, ctx.orgId);
      if (!existing) return res.status(404).json({ message: "Product not found" });
      const { engine } = await import('../../apps/server/src/engine.wiring');
      const product = await engine.updateProduct(req.params.id, req.body, ctx.orgId);
      res.json(product);
    } catch (error: any) {
      console.error("Error updating product:", error);
      if (error?.message === 'Product not found') return res.status(404).json({ message: "Product not found" });
      if (error.message?.includes('duplicate key') || error.message?.includes('unique constraint') || error.code === '23505') {
        return res.status(400).json({ 
          message: `Product code "${req.body.productCode}" already exists. Please use a different code.` 
        });
      }
      
      // Check for validation errors
      if (error.message?.includes('required') || error.message?.includes('invalid')) {
        return res.status(400).json({ message: error.message });
      }
      
      // Generic error
      res.status(500).json({ message: error.message || "Failed to update product" });
    }
  });

  app.delete("/api/products/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const existing = await storage.getProduct(req.params.id, ctx.orgId);
      if (!existing) return res.status(404).json({ message: "Product not found" });
      const { engine } = await import('../../apps/server/src/engine.wiring');
      await engine.deleteProduct(req.params.id, ctx.orgId);
      res.json({ message: "Product deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting product:", error);
      if (error?.message === 'Product not found') return res.status(404).json({ message: "Product not found" });
      res.status(500).json({ message: "Failed to delete product" });
    }
  });

  app.post("/api/products/import", ...scoped, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { rows, products: legacyProducts, duplicateMode = "skip", confirmed } = req.body;
      const list = rows ?? legacyProducts;
      if (!Array.isArray(list)) {
        return res.status(400).json({ message: "Invalid data format. Expected array of products" });
      }
      if (!confirmed) {
        return res.status(400).json({
          message: "Preview required. Use POST /api/products/import/preview then commit with confirmed: true",
        });
      }
      const result = await storage.importProducts(list, ctx.orgId, {
        duplicateMode,
        confirmed: true,
      });
      res.json(result);
    } catch (error: any) {
      console.error("Error importing products:", error);
      res.status(400).json({ message: error.message || "Failed to import products" });
    }
  });
}
