import type { Express } from "express";
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
  PurchaseDraftError,
  purchaseDraftErrorPayload,
} from "../services/purchaseDrafts";
import { PURCHASE_DRAFT_STATUSES } from "@shared/schema";
import { isAuthenticated, requireOrgContext, requireOrgScope, requireRole } from "../auth";

const scoped = [isAuthenticated, requireOrgContext, requireOrgScope];
const mutateRoles = requireRole("SUPER_ADMIN", "ADMIN", "MANAGER");

function sendError(res: any, err: unknown) {
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
  quantity: z.number().int().positive(),
  estimatedCost: z.number().min(0).optional(),
  supplierSku: z.string().optional(),
});

export function registerPurchaseDraftRoutes(app: Express) {
  app.get("/api/purchase-drafts", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const status = req.query.status as string | undefined;
      const rows = await listPurchaseDrafts(ctx.orgId, status);
      res.json(rows);
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/purchase-drafts/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const draft = await getPurchaseDraft(ctx.orgId, req.params.id);
      if (!draft) return res.status(404).json({ code: "NOT_FOUND", message: "Purchase draft not found" });
      res.json(draft);
    } catch (e) {
      sendError(res, e);
    }
  });

  app.patch("/api/purchase-drafts/:id", ...scoped, mutateRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const draft = await updatePurchaseDraft(ctx.orgId, req.params.id, req.body);
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
      const ctx = req.orgContext as { orgId: string };
      const item = await updatePurchaseDraftItem(ctx.orgId, req.params.id, req.params.itemId, req.body);
      res.json(item);
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
