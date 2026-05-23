import type { Express } from "express";
import { z } from "zod";
import {
  getReplenishmentRecommendations,
  createTransferDraftFromRecommendation,
  createPurchaseDraftFromRecommendation,
  type ReplenishmentRisk,
} from "../services/replenishment";
import { REPLENISHMENT_ACTION_TYPES } from "@shared/schema";
import { isAuthenticated, requireOrgContext, requireOrgScope, requireRole } from "../auth";

const scoped = [isAuthenticated, requireOrgContext, requireOrgScope];
const mutateRoles = requireRole("SUPER_ADMIN", "ADMIN", "MANAGER");

const transferDraftSchema = z.object({
  toLocationId: z.string().uuid(),
  notes: z.string().max(2000).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        fromLocationId: z.string().uuid(),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
  sourceRecommendationJson: z.unknown().optional(),
});

const purchaseDraftSchema = z.object({
  supplierId: z.string().uuid(),
  locationId: z.string().uuid(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().positive(),
        estimatedCost: z.number().min(0).optional(),
        supplierSku: z.string().optional(),
      }),
    )
    .min(1),
  sourceRecommendationJson: z.unknown().optional(),
});

export function registerReplenishmentRoutes(app: Express) {
  app.get("/api/replenishment/recommendations", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const result = await getReplenishmentRecommendations(ctx.orgId, {
        locationId: req.query.locationId as string | undefined,
        productId: req.query.productId as string | undefined,
        risk: req.query.risk as ReplenishmentRisk | undefined,
        actionType: req.query.actionType as (typeof REPLENISHMENT_ACTION_TYPES)[number] | undefined,
        targetCoverageDays: req.query.targetCoverageDays
          ? parseInt(String(req.query.targetCoverageDays), 10)
          : undefined,
        limit: req.query.limit ? parseInt(String(req.query.limit), 10) : undefined,
        offset: req.query.offset ? parseInt(String(req.query.offset), 10) : undefined,
      });
      res.json(result);
    } catch (e) {
      console.error(e);
      res.status(500).json({ code: "INTERNAL_ERROR", message: "Failed to load recommendations" });
    }
  });

  app.post(
    "/api/replenishment/create-transfer-draft",
    ...scoped,
    mutateRoles,
    async (req: any, res) => {
      try {
        const parsed = transferDraftSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            code: "VALIDATION_ERROR",
            message: "Invalid body",
            details: parsed.error.errors,
          });
        }
        const ctx = req.orgContext as { orgId: string };
        const transfer = await createTransferDraftFromRecommendation(ctx.orgId, {
          ...parsed.data,
          requestedBy: req.user?.claims?.sub,
        });
        res.status(201).json(transfer);
      } catch (e) {
        console.error(e);
        res.status(400).json({
          code: "TRANSFER_DRAFT_ERROR",
          message: e instanceof Error ? e.message : "Failed to create transfer draft",
        });
      }
    },
  );

  app.post(
    "/api/replenishment/create-purchase-draft",
    ...scoped,
    mutateRoles,
    async (req: any, res) => {
      try {
        const parsed = purchaseDraftSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            code: "VALIDATION_ERROR",
            message: "Invalid body",
            details: parsed.error.errors,
          });
        }
        const ctx = req.orgContext as { orgId: string };
        const draft = await createPurchaseDraftFromRecommendation(ctx.orgId, {
          ...parsed.data,
          createdBy: req.user?.claims?.sub,
        });
        res.status(201).json(draft);
      } catch (e) {
        console.error(e);
        res.status(400).json({
          code: "PURCHASE_DRAFT_ERROR",
          message: e instanceof Error ? e.message : "Failed to create purchase draft",
        });
      }
    },
  );
}
