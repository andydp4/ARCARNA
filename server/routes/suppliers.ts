import type { Express } from "express";
import { z } from "zod";
import {
  listSuppliers,
  createSupplier,
  updateSupplier,
  softDeleteSupplier,
  listProductSuppliers,
  createProductSupplier,
  updateProductSupplier,
  deleteProductSupplier,
  SupplierError,
  supplierErrorPayload,
} from "../services/suppliers";
import { isAuthenticated, requireOrgContext, requireOrgScope, requireRole } from "../replitAuth";

const scoped = [isAuthenticated, requireOrgContext, requireOrgScope];
const mutateRoles = requireRole("SUPER_ADMIN", "ADMIN", "MANAGER");

const supplierBody = z.object({
  name: z.string().min(1),
  contactName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  leadTimeDays: z.number().int().min(0).optional(),
  minOrderValue: z.number().min(0).optional(),
  minOrderQuantity: z.number().int().optional(),
});

const productSupplierBody = z.object({
  productId: z.string().uuid(),
  supplierId: z.string().uuid(),
  supplierSku: z.string().optional(),
  costPrice: z.number().min(0).optional(),
  packSize: z.number().int().min(1).optional(),
  minOrderQty: z.number().int().min(1).optional(),
  leadTimeOverrideDays: z.number().int().nullable().optional(),
  isPreferred: z.boolean().optional(),
});

function sendSupplierError(res: any, err: unknown) {
  if (err instanceof SupplierError) {
    const status =
      err.code === "NOT_FOUND" || err.code === "PRODUCT_NOT_FOUND" || err.code === "SUPPLIER_NOT_FOUND"
        ? 404
        : 400;
    return res.status(status).json(supplierErrorPayload(err));
  }
  console.error(err);
  return res.status(500).json(supplierErrorPayload(err));
}

export function registerSupplierRoutes(app: Express) {
  app.get("/api/suppliers", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const rows = await listSuppliers(ctx.orgId);
      res.json(rows);
    } catch (e) {
      sendSupplierError(res, e);
    }
  });

  app.post("/api/suppliers", ...scoped, mutateRoles, async (req: any, res) => {
    try {
      const parsed = supplierBody.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid body", details: parsed.error.errors });
      }
      const ctx = req.orgContext as { orgId: string };
      const row = await createSupplier(ctx.orgId, parsed.data);
      res.status(201).json(row);
    } catch (e) {
      sendSupplierError(res, e);
    }
  });

  app.patch("/api/suppliers/:id", ...scoped, mutateRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const row = await updateSupplier(ctx.orgId, req.params.id, req.body);
      res.json(row);
    } catch (e) {
      sendSupplierError(res, e);
    }
  });

  app.delete("/api/suppliers/:id", ...scoped, mutateRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const row = await softDeleteSupplier(ctx.orgId, req.params.id);
      res.json(row);
    } catch (e) {
      sendSupplierError(res, e);
    }
  });

  app.get("/api/product-suppliers", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const productId = req.query.productId as string | undefined;
      const supplierId = req.query.supplierId as string | undefined;
      const rows = await listProductSuppliers(ctx.orgId, productId, supplierId);
      res.json(rows);
    } catch (e) {
      sendSupplierError(res, e);
    }
  });

  app.post("/api/product-suppliers", ...scoped, mutateRoles, async (req: any, res) => {
    try {
      const parsed = productSupplierBody.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid body", details: parsed.error.errors });
      }
      const ctx = req.orgContext as { orgId: string };
      const row = await createProductSupplier(ctx.orgId, parsed.data);
      res.status(201).json(row);
    } catch (e) {
      sendSupplierError(res, e);
    }
  });

  app.patch("/api/product-suppliers/:id", ...scoped, mutateRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const row = await updateProductSupplier(ctx.orgId, req.params.id, req.body);
      res.json(row);
    } catch (e) {
      sendSupplierError(res, e);
    }
  });

  app.delete("/api/product-suppliers/:id", ...scoped, mutateRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const row = await deleteProductSupplier(ctx.orgId, req.params.id);
      res.json(row);
    } catch (e) {
      sendSupplierError(res, e);
    }
  });
}
