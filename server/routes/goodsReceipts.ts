import type { Express } from "express";
import { z } from "zod";
import {
  listGoodsReceipts,
  getGoodsReceipt,
  createGoodsReceipt,
  completeGoodsReceipt,
  voidGoodsReceipt,
  getPurchaseDraftReceiving,
  GoodsReceiptError,
  goodsReceiptErrorPayload,
} from "../services/goodsReceipts";
import { isAuthenticated, requireOrgContext, requireOrgScope, requireRole } from "../auth";

const scoped = [isAuthenticated, requireOrgContext, requireOrgScope];
const mutateRoles = requireRole("SUPER_ADMIN", "ADMIN", "MANAGER");

const createSchema = z.object({
  purchaseDraftId: z.string().uuid(),
  supplierReference: z.string().max(255).optional(),
  deliveryNote: z.string().max(500).optional(),
  items: z
    .array(
      z.object({
        purchaseDraftItemId: z.string().uuid(),
        productId: z.string().uuid(),
        quantityReceived: z.number().int().positive(),
        quantityDamaged: z.number().int().min(0).optional(),
        notes: z.string().max(500).optional(),
      }),
    )
    .min(1),
});

function sendError(res: any, err: unknown) {
  if (err instanceof GoodsReceiptError) {
    const status =
      err.code === "NOT_FOUND" || err.code === "LINE_NOT_FOUND"
        ? 404
        : err.code === "OVER_RECEIVE" || err.code === "DRAFT_CANCELLED"
          ? 409
          : 400;
    return res.status(status).json(goodsReceiptErrorPayload(err));
  }
  console.error(err);
  return res.status(500).json(goodsReceiptErrorPayload(err));
}

export function registerGoodsReceiptRoutes(app: Express) {
  app.get("/api/goods-receipts", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const rows = await listGoodsReceipts(ctx.orgId, {
        status: req.query.status as string | undefined,
        purchaseDraftId: req.query.purchaseDraftId as string | undefined,
        locationId: req.query.locationId as string | undefined,
        fromDate: req.query.fromDate ? new Date(String(req.query.fromDate)) : undefined,
        toDate: req.query.toDate ? new Date(String(req.query.toDate)) : undefined,
        limit: req.query.limit ? parseInt(String(req.query.limit), 10) : undefined,
        offset: req.query.offset ? parseInt(String(req.query.offset), 10) : undefined,
      });
      res.json(rows);
    } catch (e) {
      sendError(res, e);
    }
  });

  app.post("/api/goods-receipts", ...scoped, mutateRoles, async (req: any, res) => {
    try {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          code: "VALIDATION_ERROR",
          message: "Invalid body",
          details: parsed.error.errors,
        });
      }
      const ctx = req.orgContext as { orgId: string };
      const receipt = await createGoodsReceipt(ctx.orgId, parsed.data);
      res.status(201).json(receipt);
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/goods-receipts/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const receipt = await getGoodsReceipt(ctx.orgId, req.params.id);
      if (!receipt) {
        return res.status(404).json({ code: "NOT_FOUND", message: "Goods receipt not found" });
      }
      res.json(receipt);
    } catch (e) {
      sendError(res, e);
    }
  });

  app.post("/api/goods-receipts/:id/complete", ...scoped, mutateRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const result = await completeGoodsReceipt(
        ctx.orgId,
        req.params.id,
        req.user?.claims?.sub,
      );
      res.json(result);
    } catch (e) {
      sendError(res, e);
    }
  });

  app.post("/api/goods-receipts/:id/void", ...scoped, mutateRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const receipt = await voidGoodsReceipt(ctx.orgId, req.params.id);
      res.json(receipt);
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/purchase-drafts/:id/receiving", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const data = await getPurchaseDraftReceiving(ctx.orgId, req.params.id);
      res.json(data);
    } catch (e) {
      sendError(res, e);
    }
  });
}
