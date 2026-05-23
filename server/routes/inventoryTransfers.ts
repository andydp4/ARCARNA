import type { Express } from "express";
import { z } from "zod";
import {
  listTransfers,
  getTransfer,
  createTransfer,
  updateTransferStatus,
  TransferError,
  transferErrorPayload,
} from "../services/inventoryTransfers";
import { isAuthenticated, requireOrgContext, requireOrgScope, requireRole } from "../auth";

const scoped = [isAuthenticated, requireOrgContext, requireOrgScope];
const mutateRoles = requireRole("SUPER_ADMIN", "ADMIN", "MANAGER");

const createSchema = z.object({
  fromLocationId: z.string().uuid(),
  toLocationId: z.string().uuid(),
  notes: z.string().max(2000).optional(),
  items: z.array(
    z.object({
      productId: z.string().uuid(),
      quantity: z.number().int().positive(),
    }),
  ).min(1),
});

const statusSchema = z.object({
  status: z.enum(["draft", "requested", "in_transit", "completed", "cancelled"]),
});

function sendError(res: any, err: unknown, fallback = 500) {
  if (err instanceof TransferError) {
    const status =
      err.code === "NOT_FOUND"
        ? 404
        : err.code === "INVALID_TRANSITION" ||
            err.code === "INVALID_STATUS" ||
            err.code === "INVALID_LOCATIONS" ||
            err.code === "INVALID_ITEMS" ||
            err.code === "INVALID_QUANTITY"
          ? 400
          : err.code === "ALREADY_COMPLETED"
            ? 409
            : 400;
    return res.status(status).json(transferErrorPayload(err));
  }
  const payload = transferErrorPayload(err);
  if (payload.code === "INSUFFICIENT_STOCK") {
    return res.status(409).json(payload);
  }
  return res.status(fallback).json(payload);
}

export function registerInventoryTransferRoutes(app: Express) {
  app.get("/api/inventory/transfers", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const items = await listTransfers(ctx.orgId);
      res.json(items);
    } catch (e) {
      console.error(e);
      sendError(res, e);
    }
  });

  app.post("/api/inventory/transfers", ...scoped, mutateRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          code: "VALIDATION_ERROR",
          message: "Invalid body",
          details: parsed.error.errors,
        });
      }
      const transfer = await createTransfer(ctx.orgId, {
        ...parsed.data,
        requestedBy: req.user?.claims?.sub,
      });
      res.status(201).json(transfer);
    } catch (e) {
      console.error(e);
      sendError(res, e);
    }
  });

  app.get("/api/inventory/transfers/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const transfer = await getTransfer(ctx.orgId, req.params.id);
      if (!transfer) {
        return res.status(404).json({ code: "NOT_FOUND", message: "Transfer not found" });
      }
      res.json(transfer);
    } catch (e) {
      console.error(e);
      sendError(res, e);
    }
  });

  app.patch("/api/inventory/transfers/:id/status", ...scoped, mutateRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const parsed = statusSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          code: "VALIDATION_ERROR",
          message: "Invalid status",
          details: parsed.error.errors,
        });
      }
      const updated = await updateTransferStatus(ctx.orgId, req.params.id, parsed.data.status);
      res.json(updated);
    } catch (e) {
      console.error(e);
      sendError(res, e);
    }
  });
}
