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
import { isAuthenticated, requireOrgContext, requireOrgScope, requireRole } from "../auth";

const scoped = [isAuthenticated, requireOrgContext, requireOrgScope];
const mutateRoles = requireRole("SUPER_ADMIN", "ADMIN", "MANAGER");

/** Postgres rejects NUL bytes in text; strip control characters so a hostile
 *  or pasted string is cleaned rather than 500ing at the driver. */
const stripControlChars = (v: string) => v.replace(/[\u0000-\u001F\u007F]/g, "");

// Max lengths mirror the column widths in shared/schema.ts. Without them an
// oversized string passes validation and is rejected by the database instead,
// which surfaces as a 500 rather than a 400.
const supplierBody = z.object({
  name: z.string().min(1).max(255).transform(stripControlChars),
  contactName: z.string().max(255).transform(stripControlChars).optional(),
  email: z.string().max(255).optional(),
  phone: z.string().max(50).optional(),
  leadTimeDays: z.number().int().min(0).max(3650).optional(),
  minOrderValue: z.number().min(0).max(99_999_999).optional(),
  minOrderQuantity: z.number().int().min(0).max(1_000_000).optional(),
});

// Upper bounds matter as much as lower ones: an unbounded number passes zod and
// is then rejected by numeric(12,2)/integer at the database, surfacing as a 500.
const productSupplierBody = z.object({
  productId: z.string().uuid(),
  supplierId: z.string().uuid(),
  supplierSku: z.string().max(100).optional(),
  costPrice: z.number().min(0).max(9_999_999_999).finite().optional(),
  packSize: z.number().int().min(1).max(1_000_000).optional(),
  minOrderQty: z.number().int().min(1).max(1_000_000).optional(),
  leadTimeOverrideDays: z.number().int().min(0).max(3650).nullable().optional(),
  isPreferred: z.boolean().optional(),
});

function sendSupplierError(res: any, err: unknown) {
  // product_suppliers has a unique constraint on (org, product, supplier).
  // Re-mapping the same pair is a client mistake, not a server failure, so it
  // must answer 409 rather than surfacing as an unexplained 500.
  const pgCode = (err as { code?: string } | null)?.code
    ?? (err as { cause?: { code?: string } } | null)?.cause?.code;
  if (pgCode === "23505") {
    return res.status(409).json({
      code: "ALREADY_EXISTS",
      message: "That supplier is already mapped to this product",
    });
  }
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
      // POST validated with supplierBody; PATCH passed req.body straight to the
      // service, so a wrong-typed or oversized field reached the database and
      // came back as a 500 carrying the SQL statement.
      const parsed = supplierBody.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          code: "VALIDATION_ERROR",
          message: "Invalid body",
          details: parsed.error.errors,
        });
      }
      const ctx = req.orgContext as { orgId: string };
      const row = await updateSupplier(ctx.orgId, req.params.id, parsed.data);
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
