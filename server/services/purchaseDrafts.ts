import { db } from "../db";
import {
  purchaseDrafts,
  purchaseDraftItems,
  suppliers,
  locations,
  products,
  PURCHASE_DRAFT_STATUSES,
  goodsReceipts,
  type PurchaseDraftStatus,
} from "@shared/schema";
import { eq, and, desc, inArray, sql } from "drizzle-orm";

export class PurchaseDraftError extends Error {
  code: string;
  details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function purchaseDraftErrorPayload(err: unknown) {
  if (err instanceof PurchaseDraftError) {
    return { code: err.code, message: err.message, details: err.details };
  }
  return { code: "INTERNAL_ERROR", message: err instanceof Error ? err.message : "Unknown error" };
}

const STATUS_FLOW: Record<PurchaseDraftStatus, PurchaseDraftStatus[]> = {
  draft: ["reviewed", "cancelled"],
  reviewed: ["approved", "cancelled", "draft"],
  approved: ["cancelled"],
  partially_received: ["cancelled"],
  fully_received: [],
  cancelled: [],
};

async function loadDraftWithItems(orgId: string, id: string) {
  const [draft] = await db
    .select({
      id: purchaseDrafts.id,
      orgId: purchaseDrafts.orgId,
      supplierId: purchaseDrafts.supplierId,
      locationId: purchaseDrafts.locationId,
      status: purchaseDrafts.status,
      sourceRecommendationJson: purchaseDrafts.sourceRecommendationJson,
      createdBy: purchaseDrafts.createdBy,
      createdAt: purchaseDrafts.createdAt,
      updatedAt: purchaseDrafts.updatedAt,
      supplierName: suppliers.name,
      locationName: locations.name,
    })
    .from(purchaseDrafts)
    .innerJoin(suppliers, eq(purchaseDrafts.supplierId, suppliers.id))
    .innerJoin(locations, eq(purchaseDrafts.locationId, locations.id))
    .where(and(eq(purchaseDrafts.id, id), eq(purchaseDrafts.orgId, orgId)))
    .limit(1);

  if (!draft) return null;

  const items = await db
    .select({
      id: purchaseDraftItems.id,
      productId: purchaseDraftItems.productId,
      quantity: purchaseDraftItems.quantity,
      quantityReceived: purchaseDraftItems.quantityReceived,
      estimatedCost: purchaseDraftItems.estimatedCost,
      supplierSku: purchaseDraftItems.supplierSku,
      productName: products.name,
      sku: products.productId,
    })
    .from(purchaseDraftItems)
    .innerJoin(products, eq(purchaseDraftItems.productId, products.id))
    .where(eq(purchaseDraftItems.purchaseDraftId, id));

  return { ...draft, items };
}

export async function listPurchaseDrafts(orgId: string, status?: string) {
  const conditions = [eq(purchaseDrafts.orgId, orgId)];
  if (status) conditions.push(eq(purchaseDrafts.status, status));

  const rows = await db
    .select({
      id: purchaseDrafts.id,
      supplierId: purchaseDrafts.supplierId,
      locationId: purchaseDrafts.locationId,
      status: purchaseDrafts.status,
      createdBy: purchaseDrafts.createdBy,
      createdAt: purchaseDrafts.createdAt,
      updatedAt: purchaseDrafts.updatedAt,
      supplierName: suppliers.name,
      locationName: locations.name,
    })
    .from(purchaseDrafts)
    .innerJoin(suppliers, eq(purchaseDrafts.supplierId, suppliers.id))
    .innerJoin(locations, eq(purchaseDrafts.locationId, locations.id))
    .where(and(...conditions))
    .orderBy(desc(purchaseDrafts.updatedAt));

  if (!rows.length) return [];

  const ids = rows.map((r) => r.id);
  const itemCounts = await db
    .select({
      purchaseDraftId: purchaseDraftItems.purchaseDraftId,
      count: sql<number>`COUNT(*)::int`.as("count"),
      totalQty: sql<number>`COALESCE(SUM(${purchaseDraftItems.quantity}), 0)::int`.as("total_qty"),
    })
    .from(purchaseDraftItems)
    .where(inArray(purchaseDraftItems.purchaseDraftId, ids))
    .groupBy(purchaseDraftItems.purchaseDraftId);

  const countMap = new Map(itemCounts.map((r) => [r.purchaseDraftId, r]));

  return rows.map((r) => ({
    ...r,
    lineCount: countMap.get(r.id)?.count ?? 0,
    totalQty: countMap.get(r.id)?.totalQty ?? 0,
  }));
}

export async function getPurchaseDraft(orgId: string, id: string) {
  return loadDraftWithItems(orgId, id);
}

export async function createPurchaseDraft(
  orgId: string,
  body: {
    supplierId: string;
    locationId: string;
    createdBy?: string;
    sourceRecommendationJson?: unknown;
    items: {
      productId: string;
      quantity: number;
      estimatedCost?: string | number;
      supplierSku?: string;
    }[];
  },
) {
  if (!body.items.length) {
    throw new PurchaseDraftError("VALIDATION_ERROR", "At least one line item required");
  }

  return db.transaction(async (tx) => {
    const [draft] = await tx
      .insert(purchaseDrafts)
      .values({
        orgId,
        supplierId: body.supplierId,
        locationId: body.locationId,
        status: "draft",
        createdBy: body.createdBy,
        sourceRecommendationJson: body.sourceRecommendationJson ?? null,
      })
      .returning();

    for (const line of body.items) {
      if (line.quantity <= 0) {
        throw new PurchaseDraftError("VALIDATION_ERROR", "Quantity must be positive");
      }
      await tx.insert(purchaseDraftItems).values({
        purchaseDraftId: draft.id,
        orgId,
        productId: line.productId,
        quantity: line.quantity,
        estimatedCost: line.estimatedCost != null ? String(line.estimatedCost) : null,
        supplierSku: line.supplierSku,
      });
    }

    return loadDraftWithItems(orgId, draft.id);
  });
}

export async function updatePurchaseDraft(
  orgId: string,
  id: string,
  patch: { supplierId?: string; locationId?: string },
) {
  const existing = await loadDraftWithItems(orgId, id);
  if (!existing) throw new PurchaseDraftError("NOT_FOUND", "Purchase draft not found");
  if (
    existing.status === "cancelled" ||
    existing.status === "fully_received" ||
    existing.status === "approved" ||
    existing.status === "partially_received"
  ) {
    throw new PurchaseDraftError(
      "INVALID_STATUS",
      "Cannot edit supplier/location after approval — cancel only if no pending receipts",
    );
  }

  await db
    .update(purchaseDrafts)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(purchaseDrafts.id, id), eq(purchaseDrafts.orgId, orgId)));

  return loadDraftWithItems(orgId, id);
}

export async function setPurchaseDraftStatus(orgId: string, id: string, status: PurchaseDraftStatus) {
  if (!PURCHASE_DRAFT_STATUSES.includes(status)) {
    throw new PurchaseDraftError("VALIDATION_ERROR", "Invalid status");
  }

  const existing = await loadDraftWithItems(orgId, id);
  if (!existing) throw new PurchaseDraftError("NOT_FOUND", "Purchase draft not found");

  const current = existing.status as PurchaseDraftStatus;
  if (current === status) return existing;

  if (status === "partially_received" || status === "fully_received") {
    throw new PurchaseDraftError(
      "INVALID_TRANSITION",
      "Receiving status is set automatically when goods receipts are completed",
    );
  }

  if (status === "cancelled" && (current === "approved" || current === "partially_received")) {
    const [pending] = await db
      .select({ count: sql<number>`COUNT(*)::int`.as("count") })
      .from(goodsReceipts)
      .where(
        and(
          eq(goodsReceipts.purchaseDraftId, id),
          eq(goodsReceipts.orgId, orgId),
          eq(goodsReceipts.status, "pending"),
        ),
      );
    if ((pending?.count ?? 0) > 0) {
      throw new PurchaseDraftError(
        "PENDING_RECEIPTS",
        "Void or complete pending goods receipts before cancelling this draft",
      );
    }
  }

  if (!STATUS_FLOW[current]?.includes(status)) {
    throw new PurchaseDraftError(
      "INVALID_TRANSITION",
      `Cannot transition from ${current} to ${status}`,
    );
  }

  await db
    .update(purchaseDrafts)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(purchaseDrafts.id, id), eq(purchaseDrafts.orgId, orgId)));

  return loadDraftWithItems(orgId, id);
}

export async function deletePurchaseDraft(orgId: string, id: string) {
  const existing = await loadDraftWithItems(orgId, id);
  if (!existing) throw new PurchaseDraftError("NOT_FOUND", "Purchase draft not found");
  if (!["draft", "reviewed"].includes(existing.status)) {
    throw new PurchaseDraftError(
      "INVALID_STATUS",
      "Only draft or reviewed purchase drafts can be deleted",
    );
  }

  const [row] = await db
    .delete(purchaseDrafts)
    .where(and(eq(purchaseDrafts.id, id), eq(purchaseDrafts.orgId, orgId)))
    .returning();
  if (!row) throw new PurchaseDraftError("NOT_FOUND", "Purchase draft not found");
  return row;
}

export async function addPurchaseDraftItem(
  orgId: string,
  draftId: string,
  line: {
    productId: string;
    quantity: number;
    estimatedCost?: string | number;
    supplierSku?: string;
  },
) {
  const draft = await loadDraftWithItems(orgId, draftId);
  if (!draft) throw new PurchaseDraftError("NOT_FOUND", "Purchase draft not found");
  if (
    draft.status === "cancelled" ||
    draft.status === "approved" ||
    draft.status === "partially_received" ||
    draft.status === "fully_received"
  ) {
    throw new PurchaseDraftError("INVALID_STATUS", "Cannot modify items in this status");
  }

  const [item] = await db
    .insert(purchaseDraftItems)
    .values({
      purchaseDraftId: draftId,
      orgId,
      productId: line.productId,
      quantity: line.quantity,
      estimatedCost: line.estimatedCost != null ? String(line.estimatedCost) : null,
      supplierSku: line.supplierSku,
    })
    .returning();

  await db
    .update(purchaseDrafts)
    .set({ updatedAt: new Date() })
    .where(eq(purchaseDrafts.id, draftId));

  return item;
}

export async function updatePurchaseDraftItem(
  orgId: string,
  draftId: string,
  itemId: string,
  patch: Partial<{
    quantity: number;
    estimatedCost: string | number | null;
    supplierSku: string | null;
  }>,
) {
  const draft = await loadDraftWithItems(orgId, draftId);
  if (!draft) throw new PurchaseDraftError("NOT_FOUND", "Purchase draft not found");
  if (
    draft.status === "cancelled" ||
    draft.status === "approved" ||
    draft.status === "partially_received" ||
    draft.status === "fully_received"
  ) {
    throw new PurchaseDraftError("INVALID_STATUS", "Cannot modify items in this status");
  }

  const [item] = await db
    .update(purchaseDraftItems)
    .set({
      quantity: patch.quantity,
      estimatedCost:
        patch.estimatedCost !== undefined
          ? patch.estimatedCost == null
            ? null
            : String(patch.estimatedCost)
          : undefined,
      supplierSku: patch.supplierSku,
    })
    .where(
      and(
        eq(purchaseDraftItems.id, itemId),
        eq(purchaseDraftItems.purchaseDraftId, draftId),
        eq(purchaseDraftItems.orgId, orgId),
      ),
    )
    .returning();

  if (!item) throw new PurchaseDraftError("NOT_FOUND", "Line item not found");

  await db
    .update(purchaseDrafts)
    .set({ updatedAt: new Date() })
    .where(eq(purchaseDrafts.id, draftId));

  return item;
}

export async function deletePurchaseDraftItem(orgId: string, draftId: string, itemId: string) {
  const draft = await loadDraftWithItems(orgId, draftId);
  if (!draft) throw new PurchaseDraftError("NOT_FOUND", "Purchase draft not found");
  if (
    draft.status === "cancelled" ||
    draft.status === "approved" ||
    draft.status === "partially_received" ||
    draft.status === "fully_received"
  ) {
    throw new PurchaseDraftError("INVALID_STATUS", "Cannot modify items in this status");
  }

  const [item] = await db
    .delete(purchaseDraftItems)
    .where(
      and(
        eq(purchaseDraftItems.id, itemId),
        eq(purchaseDraftItems.purchaseDraftId, draftId),
        eq(purchaseDraftItems.orgId, orgId),
      ),
    )
    .returning();

  if (!item) throw new PurchaseDraftError("NOT_FOUND", "Line item not found");

  await db
    .update(purchaseDrafts)
    .set({ updatedAt: new Date() })
    .where(eq(purchaseDrafts.id, draftId));

  return item;
}
