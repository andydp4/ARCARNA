import type { Express, RequestHandler } from "express";
import { z } from "zod";
import {
  listPurchaseDrafts,
  getPurchaseDraft,
  updatePurchaseDraft,
  setPurchaseDraftStatus,
  deletePurchaseDraft,
  addPurchaseDraftItem,
  updatePurchaseDraftItem,
  deletePurchaseDraftItem,
  getPurchaseDraftForExport,
  PURCHASE_ORDER_EXPORTABLE_STATUSES,
  PurchaseDraftError,
  purchaseDraftErrorPayload,
} from "../services/purchaseDrafts";
import { PURCHASE_DRAFT_STATUSES } from "@shared/schema";
import { isAuthenticated, requireOrgContext, requireOrgScope, requireRole } from "../auth";
import { rolesAtLeast } from "@shared/accessPolicy";
import { positiveQuantity } from "@shared/quantity";
import { resolvePurchaseUnitCost } from "@shared/purchasing/purchaseLines";
import { recordAdminAudit } from "../adminAudit";

const defaultScoped: RequestHandler[] = [isAuthenticated, requireOrgContext, requireOrgScope];
const mutateRoles = requireRole("SUPER_ADMIN", "ADMIN", "MANAGER");

/**
 * Reads are manager and above too: supplier, purchasing, receiving and
 * transfer records all carry cost prices, which cashiers never see (owner
 * decision Q6; shared/accessPolicy.ts).
 */
const readRoles = requireRole(...rolesAtLeast("MANAGER"));

function sendError(res: any, err: unknown) {
  if ((err as any)?.code === '23503') return res.status(409).json({ message: "Cannot delete: still referenced by goods receipts or other records. Archive it instead." });
  if (err instanceof PurchaseDraftError) {
    const status =
      err.code === "NOT_FOUND"
        ? 404
        : err.code === "INVALID_TRANSITION" || err.code === "INVALID_STATUS"
          ? 400
          : 400;
    return res.status(status).json(purchaseDraftErrorPayload(err));
  }
  console.error(err);
  return res.status(500).json(purchaseDraftErrorPayload(err));
}

const itemSchema = z.object({
  productId: z.string().uuid(),
  quantity: positiveQuantity,
  estimatedCost: z.number().min(0).optional(),
  supplierSku: z.string().optional(),
});

/**
 * The PATCH route previously passed req.body straight into the update with no
 * validation — 0, negative numbers and strings like "5" were written as-is,
 * and a genuinely invalid value like "abc" hit Postgres directly as a raw
 * 500. Reuses the same positiveQuantity scale as the POST-items route above.
 */
const itemPatchSchema = z
  .object({
    quantity: positiveQuantity.optional(),
    // A unit cost must be a real amount; null clears it so the line prices
    // from the supplier link or product card. 0 used to be accepted here and
    // then silently treated as "no cost" everywhere it was read.
    estimatedCost: z.number().positive().max(9_999_999_999).nullable().optional(),
    supplierSku: z.string().nullable().optional(),
  })
  .strict();

const draftPatchSchema = z
  .object({
    supplierId: z.string().uuid().optional(),
    locationId: z.string().uuid().optional(),
  })
  .strict();

/**
 * `scopedMiddleware` defaults to the real auth + org-context chain; tests pass
 * a stand-in that sets req.user / req.orgContext, so role checks
 * (`mutateRoles`) still run for real.
 */
export function registerPurchaseDraftRoutes(app: Express, scopedMiddleware: RequestHandler[] = defaultScoped) {
  const scoped = scopedMiddleware;
  app.get("/api/purchase-drafts", ...scoped, readRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const status = req.query.status as string | undefined;
      const rows = await listPurchaseDrafts(ctx.orgId, status);
      res.json(rows);
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/purchase-drafts/:id", ...scoped, readRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const draft = await getPurchaseDraft(ctx.orgId, req.params.id);
      if (!draft) return res.status(404).json({ code: "NOT_FOUND", message: "Purchase draft not found" });
      res.json(draft);
    } catch (e) {
      sendError(res, e);
    }
  });

  // ARC-019: the only thing an approved draft could previously produce for a
  // supplier was a bare CSV of SKU/qty/cost with no supplier identity at
  // all. This renders a real, printable purchase-order document instead —
  // supplier name and contact details, a PO reference, line items, dates.
  // No role gate beyond `scoped`, matching the existing CSV export button
  // (any user who can view the draft can export it; only status-changing
  // actions are restricted to `mutateRoles`).
  app.get("/api/purchase-drafts/:id/export", ...scoped, readRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const data = await getPurchaseDraftForExport(ctx.orgId, req.params.id);
      if (!data) return res.status(404).json({ code: "NOT_FOUND", message: "Purchase draft not found" });
      if (!PURCHASE_ORDER_EXPORTABLE_STATUSES.includes(data.status as any)) {
        return res.status(400).json({
          code: "NOT_APPROVED",
          message: "Export the purchase order once the draft has been approved",
        });
      }

      const { generatePurchaseOrderPdf } = await import("../services/purchaseOrderExport");
      const { loadCompanyInfo } = await import("../services/companyBranding");

      const buyer = await loadCompanyInfo(ctx.orgId);
      const poNumber = `PO-${data.id.slice(0, 8).toUpperCase()}`;
      const createdAt = (data.createdAt ?? new Date()).toISOString();
      // A delivery estimate, not a promise from the supplier — only computed
      // when the supplier has a configured lead time to derive it from.
      const estimatedDeliveryDate = data.supplierLeadTimeDays
        ? new Date(
            (data.createdAt ?? new Date()).getTime() + data.supplierLeadTimeDays * 24 * 60 * 60 * 1000,
          ).toISOString()
        : null;

      const pdf = await generatePurchaseOrderPdf({
        poNumber,
        status: data.status,
        createdAt,
        estimatedDeliveryDate,
        buyer,
        supplier: {
          name: data.supplierName,
          contactName: data.supplierContactName,
          email: data.supplierEmail,
          phone: data.supplierPhone,
        },
        deliverTo: {
          name: data.locationName,
          address: [data.locationAddress, data.locationCity, data.locationState, data.locationZip]
            .filter(Boolean)
            .join(", "),
        },
        items: data.items.map((item) => ({
          sku: item.sku,
          productName: item.productName,
          quantity: item.quantity,
          // Drafts raised before the product-card fallback existed carry no
          // line cost; price them from the product card at export rather than
          // printing "—" and an estimated total of £0.00.
          unitCost: resolvePurchaseUnitCost({
            lineCost: item.estimatedCost,
            supplierCost: item.supplierCostPrice,
            productCost: item.productCostPrice,
          }).unitCost,
          supplierSku: item.supplierSku,
        })),
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${poNumber}.pdf"`);
      res.send(pdf);
    } catch (e) {
      sendError(res, e);
    }
  });

  app.patch("/api/purchase-drafts/:id", ...scoped, mutateRoles, async (req: any, res) => {
    try {
      const parsed = draftPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid body" });
      }
      const ctx = req.orgContext as { orgId: string };
      const draft = await updatePurchaseDraft(ctx.orgId, req.params.id, parsed.data);
      res.json(draft);
    } catch (e) {
      sendError(res, e);
    }
  });

  app.delete("/api/purchase-drafts/:id", ...scoped, mutateRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const row = await deletePurchaseDraft(ctx.orgId, req.params.id);
      res.json(row);
    } catch (e) {
      sendError(res, e);
    }
  });

  app.patch("/api/purchase-drafts/:id/status", ...scoped, mutateRoles, async (req: any, res) => {
    try {
      const parsed = z.object({ status: z.enum(PURCHASE_DRAFT_STATUSES) }).safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid status" });
      }
      const ctx = req.orgContext as { orgId: string };
      const draft = await setPurchaseDraftStatus(ctx.orgId, req.params.id, parsed.data.status);
      res.json(draft);
    } catch (e) {
      sendError(res, e);
    }
  });

  app.post("/api/purchase-drafts/:id/items", ...scoped, mutateRoles, async (req: any, res) => {
    try {
      const parsed = itemSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ code: "VALIDATION_ERROR", message: "Invalid body" });
      }
      const ctx = req.orgContext as { orgId: string };
      const item = await addPurchaseDraftItem(ctx.orgId, req.params.id, parsed.data);
      res.status(201).json(item);
    } catch (e) {
      sendError(res, e);
    }
  });

  app.patch("/api/purchase-drafts/:id/items/:itemId", ...scoped, mutateRoles, async (req: any, res) => {
    try {
      const parsed = itemPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          code: "VALIDATION_ERROR",
          message: parsed.error.errors[0]?.message ?? "Invalid body",
        });
      }
      const ctx = req.orgContext as { orgId: string; role: string };
      const { amendedAfterApproval, changed, previous, ...item } = await updatePurchaseDraftItem(
        ctx.orgId,
        req.params.id,
        req.params.itemId,
        parsed.data,
      );
      if (amendedAfterApproval && changed) {
        await recordAdminAudit(req, {
          actorUserId: req.user?.claims?.sub ?? "unknown",
          actorRole: ctx.role,
          action: "purchase_draft.line_amended_after_approval",
          targetType: "purchase_draft",
          targetId: req.params.id,
          orgId: ctx.orgId,
          metadata: {
            itemId: req.params.itemId,
            from: previous,
            to: { quantity: item.quantity, estimatedCost: item.estimatedCost, supplierSku: item.supplierSku },
          },
        });
      }
      res.json({ ...item, amendedAfterApproval: amendedAfterApproval && changed });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.delete("/api/purchase-drafts/:id/items/:itemId", ...scoped, mutateRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const item = await deletePurchaseDraftItem(ctx.orgId, req.params.id, req.params.itemId);
      res.json(item);
    } catch (e) {
      sendError(res, e);
    }
  });
}
