import type { Express, RequestHandler } from "express";
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
import { nonNegativeQuantity, positiveQuantity } from "@shared/quantity";
import { recordAdminAudit } from "../adminAudit";

const defaultScoped: RequestHandler[] = [isAuthenticated, requireOrgContext, requireOrgScope];
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
        quantityReceived: positiveQuantity,
        quantityDamaged: nonNegativeQuantity.optional(),
        notes: z.string().max(500).optional(),
      }),
    )
    .min(1)
    // A real receipt has one line per draft line. The 25 MB global body limit
    // was the only ceiling, so a payload could carry an unbounded array.
    .max(1000),
  /**
   * The draft lines a manager confirmed the supplier over-delivered on.
   * Stored on the receipt line and acted on only at completion (migration
   * 070); any other line over what is outstanding is refused with 409
   * OVER_RECEIVE so the screen can ask.
   */
  acceptOverDeliveryLineIds: z.array(z.string().uuid()).max(1000).optional(),
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

/**
 * `scopedMiddleware` defaults to the real auth + org-context chain; tests pass
 * a stand-in that sets req.user / req.orgContext, so role checks
 * (`mutateRoles`) still run for real.
 */
export function registerGoodsReceiptRoutes(app: Express, scopedMiddleware: RequestHandler[] = defaultScoped) {
  const scoped = scopedMiddleware;
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
      const ctx = req.orgContext as { orgId: string; role: string };
      const { acceptOverDeliveryLineIds, ...body } = parsed.data;
      const receipt = await createGoodsReceipt(ctx.orgId, body, { acceptOverDeliveryLineIds });
      if (receipt?.overDelivery?.length) {
        // Who confirmed it, and for how much. The order itself only changes
        // at completion, which writes its own entry with the real figures.
        await recordAdminAudit(req, {
          actorUserId: req.user?.claims?.sub ?? "unknown",
          actorRole: ctx.role,
          action: "goods_receipt.over_delivery_confirmed",
          targetType: "purchase_draft",
          targetId: body.purchaseDraftId,
          orgId: ctx.orgId,
          metadata: { receiptId: receipt.id, lines: receipt.overDelivery },
        });
      }
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
      const ctx = req.orgContext as { orgId: string; role: string };
      const result = await completeGoodsReceipt(
        ctx.orgId,
        req.params.id,
        req.user?.claims?.sub,
      );
      if (result.overDeliveryRaised.length) {
        // Figures read and written under the completion's own row locks.
        await recordAdminAudit(req, {
          actorUserId: req.user?.claims?.sub ?? "unknown",
          actorRole: ctx.role,
          action: "goods_receipt.over_delivery_accepted",
          targetType: "purchase_draft",
          targetId: result.receipt?.purchaseDraftId ?? null,
          orgId: ctx.orgId,
          metadata: { receiptId: req.params.id, lines: result.overDeliveryRaised },
        });
      }
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
