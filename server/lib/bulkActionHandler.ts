import type { Request } from "express";
import { db } from "../db";
import { customers, orders, products } from "@shared/schema";
import { storage } from "../storage";
import { recordAdminAudit } from "../adminAudit";
import {
  getBulkActionDef,
  isBulkActionAllowed,
  parseBulkRequest,
  type BulkEntity,
} from "@shared/bulkActions";
import type { Role } from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";

type OrgContext = { orgId: string; role: Role; userId?: string };

export async function handleBulkAction(
  req: Request,
  entity: BulkEntity,
  ctx: OrgContext,
): Promise<{ ok: true; result: unknown } | { ok: false; status: number; message: string }> {
  const parsed = parseBulkRequest(req.body);
  if (!parsed) return { ok: false, status: 400, message: "Invalid bulk request" };
  if (!isBulkActionAllowed(entity, parsed.action, ctx.role)) {
    return { ok: false, status: 403, message: "Action not permitted for your role" };
  }

  const def = getBulkActionDef(entity, parsed.action);
  if (!def) return { ok: false, status: 400, message: "Unknown action" };

  const actorUserId = ctx.userId ?? (req as any).user?.id ?? "unknown";

  switch (entity) {
    case "customers":
      return handleCustomerBulk(req, ctx, parsed, actorUserId);
    case "products":
      return handleProductBulk(req, ctx, parsed, actorUserId);
    case "orders":
      return handleOrderBulk(req, ctx, parsed, actorUserId);
    default:
      return { ok: false, status: 400, message: "Unknown entity" };
  }
}

async function handleCustomerBulk(
  req: Request,
  ctx: OrgContext,
  parsed: ReturnType<typeof parseBulkRequest> & object,
  actorUserId: string,
) {
  const { ids, action, payload } = parsed;

  if (action === "export") {
    const rows = await db
      .select()
      .from(customers)
      .where(and(eq(customers.orgId, ctx.orgId), inArray(customers.id, ids)));
    return { ok: true as const, result: { rows, format: "csv" } };
  }

  if (action === "tag") {
    const category = String(payload?.category ?? "").trim();
    if (!category) return { ok: false as const, status: 400, message: "category required" };
    await db
      .update(customers)
      .set({ category, updatedAt: new Date() })
      .where(and(eq(customers.orgId, ctx.orgId), inArray(customers.id, ids)));
    await recordAdminAudit(req, {
      actorUserId,
      actorRole: ctx.role,
      action: "bulk.tag",
      targetType: "customer",
      orgId: ctx.orgId,
      metadata: { count: ids.length, ids, category },
    });
    return { ok: true as const, result: { updated: ids.length } };
  }

  if (action === "delete") {
    const { engine } = await import("../../apps/server/src/engine.wiring");
    await db.transaction(async () => {
      for (const id of ids) {
        const existing = await storage.getCustomer(id, ctx.orgId);
        if (!existing) throw new Error(`Customer ${id} not found`);
        await engine.deleteCustomer(id, ctx.orgId);
      }
    });
    await recordAdminAudit(req, {
      actorUserId,
      actorRole: ctx.role,
      action: "bulk.delete",
      targetType: "customer",
      orgId: ctx.orgId,
      metadata: { count: ids.length, ids },
    });
    return { ok: true as const, result: { deleted: ids.length } };
  }

  return { ok: false as const, status: 400, message: "Unsupported action" };
}

async function handleProductBulk(
  req: Request,
  ctx: OrgContext,
  parsed: ReturnType<typeof parseBulkRequest> & object,
  actorUserId: string,
) {
  const { ids, action } = parsed;

  if (action === "export") {
    const rows = await db
      .select()
      .from(products)
      .where(and(eq(products.orgId, ctx.orgId), inArray(products.id, ids)));
    return { ok: true as const, result: { rows, format: "csv" } };
  }

  if (action === "delete") {
    const { engine } = await import("../../apps/server/src/engine.wiring");
    await db.transaction(async () => {
      for (const id of ids) {
        const existing = await storage.getProduct(id, ctx.orgId);
        if (!existing) throw new Error(`Product ${id} not found`);
        await engine.deleteProduct(id, ctx.orgId);
      }
    });
    await recordAdminAudit(req, {
      actorUserId,
      actorRole: ctx.role,
      action: "bulk.delete",
      targetType: "product",
      orgId: ctx.orgId,
      metadata: { count: ids.length, ids },
    });
    return { ok: true as const, result: { deleted: ids.length } };
  }

  return { ok: false as const, status: 400, message: "Unsupported action" };
}

async function handleOrderBulk(
  req: Request,
  ctx: OrgContext,
  parsed: ReturnType<typeof parseBulkRequest> & object,
  actorUserId: string,
) {
  const { ids, action, payload } = parsed;

  if (action === "export") {
    const rows = await db
      .select()
      .from(orders)
      .where(and(eq(orders.orgId, ctx.orgId), inArray(orders.id, ids)));
    return { ok: true as const, result: { rows, format: "csv" } };
  }

  if (action === "tag") {
    const status = String(payload?.status ?? "").trim();
    if (!status) return { ok: false as const, status: 400, message: "status required" };
    await db
      .update(orders)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(orders.orgId, ctx.orgId), inArray(orders.id, ids)));
    await recordAdminAudit(req, {
      actorUserId,
      actorRole: ctx.role,
      action: "bulk.tag",
      targetType: "order",
      orgId: ctx.orgId,
      metadata: { count: ids.length, ids, status },
    });
    return { ok: true as const, result: { updated: ids.length } };
  }

  return { ok: false as const, status: 400, message: "Unsupported action" };
}

export function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const keys = Object.keys(rows[0]);
  const header = keys.join(",");
  const lines = rows.map((row) =>
    keys
      .map((key) => {
        const val = row[key];
        if (val == null) return "";
        const str = String(val);
        return str.includes(",") || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
      })
      .join(","),
  );
  return [header, ...lines].join("\n");
}
