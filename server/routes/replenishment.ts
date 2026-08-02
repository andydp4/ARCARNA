import type { Express } from "express";
import { z } from "zod";
import {
  getReplenishmentRecommendations,
  createTransferDraftFromRecommendation,
  createPurchaseDraftFromRecommendation,
  createPurchaseDraftsFromRecommendations,
  type ReplenishmentRisk,
} from "../services/replenishment";
import { PurchaseDraftError, purchaseDraftErrorPayload } from "../services/purchaseDrafts";
import {
  StockError,
  TransferError,
  transferErrorPayload,
} from "../services/inventoryTransfers";
import { REPLENISHMENT_ACTION_TYPES } from "@shared/schema";
import { positiveQuantity } from "@shared/quantity";
import { isAuthenticated, requireOrgContext, requireOrgScope, requireRole } from "../auth";

const scoped = [isAuthenticated, requireOrgContext, requireOrgScope];
const mutateRoles = requireRole("SUPER_ADMIN", "ADMIN", "MANAGER");

/**
 * Line quantities come from the shared contract, which bounds them to what the
 * column can hold. Unbounded, a quantity past the column's range passed
 * validation and became a Drizzle insert failure — echoed to the caller with
 * the statement and its parameters. The columns are numeric(14,3) now, so this
 * also carries the decimal rules rather than restating them.
 */
const lineQuantity = positiveQuantity;

const transferDraftSchema = z.object({
  toLocationId: z.string().uuid(),
  notes: z.string().max(2000).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        fromLocationId: z.string().uuid(),
        quantity: lineQuantity,
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
        quantity: lineQuantity,
        estimatedCost: z.number().min(0).optional(),
        supplierSku: z.string().optional(),
      }),
    )
    .min(1),
  sourceRecommendationJson: z.unknown().optional(),
});

const purchaseDraftBatchSchema = z.object({
  lines: z
    .array(
      z.object({
        supplierId: z.string().uuid(),
        locationId: z.string().uuid(),
        productId: z.string().uuid(),
        quantity: lineQuantity,
        estimatedCost: z.number().min(0).optional(),
        supplierSku: z.string().max(100).optional(),
        recommendation: z.unknown().optional(),
      }),
    )
    .min(1)
    .max(500),
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
        // Same leak as the purchase-draft routes below: e.message on a Drizzle
        // failure is the SQL statement and its bound parameters.
        const known = e instanceof TransferError || e instanceof StockError;
        res.status(known ? 400 : 500).json(transferErrorPayload(e));
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
        // Echoing e.message handed the caller the Drizzle error verbatim —
        // "Failed query: insert into purchase_draft_items (...) values ($1...)"
        // plus the bound parameters, i.e. the schema and the tenant id.
        res.status(e instanceof PurchaseDraftError ? 400 : 500).json(purchaseDraftErrorPayload(e));
      }
    },
  );

  app.post(
    "/api/replenishment/create-purchase-drafts",
    ...scoped,
    mutateRoles,
    async (req: any, res) => {
      try {
        const parsed = purchaseDraftBatchSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            code: "VALIDATION_ERROR",
            message: "Invalid body",
            details: parsed.error.errors,
          });
        }
        const ctx = req.orgContext as { orgId: string };
        const result = await createPurchaseDraftsFromRecommendations(ctx.orgId, {
          ...parsed.data,
          createdBy: req.user?.claims?.sub,
        });
        res.status(201).json(result);
      } catch (e) {
        console.error(e);
        res.status(e instanceof PurchaseDraftError ? 400 : 500).json(purchaseDraftErrorPayload(e));
      }
    },
  );
}
