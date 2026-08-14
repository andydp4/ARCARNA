import { db } from "../db";

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
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

/**
 * Insert guards. Drizzle's `$inferInsert` makes any column with a database
 * default OPTIONAL, so an insert that omits one compiles and writes the default
 * — which is how an order's fulfilment_method was silently persisted as
 * "collection" when the till said "delivery" (see apps/server/src/db/repos.ts).
 *
 * `status` is the one that bites here: it defaults to "draft", so omitting it
 * from a values object would quietly reopen a draft rather than fail. `orgId` is
 * the tenant, and a draft written without one belongs to nobody and is invisible
 * to every org-scoped query in this file.
 */
type PurchaseDraftInsert = typeof purchaseDrafts.$inferInsert &
  Required<Pick<typeof purchaseDrafts.$inferInsert, "orgId" | "supplierId" | "locationId" | "status">>;

type PurchaseDraftItemInsert = typeof purchaseDraftItems.$inferInsert &
  Required<
    Pick<typeof purchaseDraftItems.$inferInsert, "purchaseDraftId" | "orgId" | "productId" | "quantity">
  >;


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
  // Never echo the raw error: unhandled failures here are Drizzle/pg errors
  // whose message contains the full SQL statement and column list. The real
  // error is logged server-side by the caller.
  return { code: "INTERNAL_ERROR", message: "An unexpected error occurred" };
}

const STATUS_FLOW: Record<PurchaseDraftStatus, PurchaseDraftStatus[]> = {
  draft: ["reviewed", "cancelled"],
  reviewed: ["approved", "cancelled", "draft"],
  approved: ["cancelled"],
  partially_received: ["cancelled"],
  fully_received: [],
  cancelled: [],
};

/**
 * Statuses where ordered quantity is still expected to arrive. Replenishment
 * subtracts the outstanding quantity on these drafts so a product that has
 * already been ordered is not recommended for purchase a second time.
 */
export const OPEN_PURCHASE_DRAFT_STATUSES: PurchaseDraftStatus[] = [
  "draft",
  "reviewed",
  "approved",
  "partially_received",
];

export type PurchaseDraftLineInput = {
  productId: string;
  quantity: number;
  estimatedCost?: string | number;
  supplierSku?: string;
};

export type PurchaseDraftGroupInput = {
  supplierId: string;
  locationId: string;
  createdBy?: string;
  sourceRecommendationJson?: unknown;
  items: PurchaseDraftLineInput[];
};

export function onOrderKey(productId: string, locationId: string) {
  return `${productId}:${locationId}`;
}

/**
 * Outstanding (ordered but not yet received) quantity per product+location
 * across all open purchase drafts, keyed by `onOrderKey`.
 */
export async function getOnOrderQuantities(orgId: string) {
  const rows = await db
    .select({
      productId: purchaseDraftItems.productId,
      locationId: purchaseDrafts.locationId,
      outstanding: sql<number>`COALESCE(SUM(GREATEST(${purchaseDraftItems.quantity} - ${purchaseDraftItems.quantityReceived}, 0)), 0)::int`.as(
        "outstanding",
      ),
    })
    .from(purchaseDraftItems)
    .innerJoin(purchaseDrafts, eq(purchaseDraftItems.purchaseDraftId, purchaseDrafts.id))
    .where(
      and(
        eq(purchaseDraftItems.orgId, orgId),
        eq(purchaseDrafts.orgId, orgId),
        inArray(purchaseDrafts.status, OPEN_PURCHASE_DRAFT_STATUSES),
      ),
    )
    .groupBy(purchaseDraftItems.productId, purchaseDrafts.locationId);

  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(onOrderKey(row.productId, row.locationId), Number(row.outstanding) || 0);
  }
  return map;
}

/**
 * Open drafts for the given supplier+location pairs, so callers can warn that a
 * new draft would sit alongside an existing one rather than extending it.
 */
export async function findOpenDraftsForPairs(
  orgId: string,
  pairs: { supplierId: string; locationId: string }[],
) {
  if (!pairs.length) return [];
  const supplierIds = Array.from(new Set(pairs.map((p) => p.supplierId)));
  const locationIds = Array.from(new Set(pairs.map((p) => p.locationId)));

  const rows = await db
    .select({
      id: purchaseDrafts.id,
      supplierId: purchaseDrafts.supplierId,
      locationId: purchaseDrafts.locationId,
      status: purchaseDrafts.status,
      supplierName: suppliers.name,
      locationName: locations.name,
    })
    .from(purchaseDrafts)
    .innerJoin(suppliers, and(eq(purchaseDrafts.supplierId, suppliers.id), eq(suppliers.orgId, orgId)))
    .innerJoin(locations, and(eq(purchaseDrafts.locationId, locations.id), eq(locations.orgId, orgId)))
    .where(
      and(
        eq(purchaseDrafts.orgId, orgId),
        inArray(purchaseDrafts.supplierId, supplierIds),
        inArray(purchaseDrafts.locationId, locationIds),
        inArray(purchaseDrafts.status, OPEN_PURCHASE_DRAFT_STATUSES),
      ),
    );

  const wanted = new Set(pairs.map((p) => `${p.supplierId}:${p.locationId}`));
  return rows.filter((r) => wanted.has(`${r.supplierId}:${r.locationId}`));
}

async function loadDraftWithItems(orgId: string, id: string, executor: DbTx | typeof db = db) {
  const [draft] = await executor
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
    .innerJoin(suppliers, and(eq(purchaseDrafts.supplierId, suppliers.id), eq(suppliers.orgId, orgId)))
    .innerJoin(locations, and(eq(purchaseDrafts.locationId, locations.id), eq(locations.orgId, orgId)))
    .where(and(eq(purchaseDrafts.id, id), eq(purchaseDrafts.orgId, orgId)))
    .limit(1);

  if (!draft) return null;

  const items = await executor
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
    .innerJoin(products, and(eq(purchaseDraftItems.productId, products.id), eq(products.orgId, orgId)))
    .where(and(eq(purchaseDraftItems.purchaseDraftId, id), eq(purchaseDraftItems.orgId, orgId)));

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
    .innerJoin(suppliers, and(eq(purchaseDrafts.supplierId, suppliers.id), eq(suppliers.orgId, orgId)))
    .innerJoin(locations, and(eq(purchaseDrafts.locationId, locations.id), eq(locations.orgId, orgId)))
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
    .where(and(eq(purchaseDraftItems.orgId, orgId), inArray(purchaseDraftItems.purchaseDraftId, ids)))
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

/**
 * Every id on the draft must belong to the calling org.
 *
 * The insert below stamps `orgId` from the caller's context onto the draft and
 * its lines, which makes the new rows look correctly tenanted while they point
 * at another organisation's supplier, location and products. Nothing downstream
 * re-checks: loadDraftWithItems inner-joins those tables without an org
 * predicate, so tenant C could raise a draft against tenant B's supplier at
 * tenant B's location and read B's product names straight back out of it.
 *
 * Checked in ONE query per table rather than per line: a draft with fifty lines
 * should not cost fifty round trips, and `inArray` gives the same answer.
 */
async function assertSupplierBelongsToOrg(
  tx: DbTx,
  orgId: string,
  supplierId: string,
): Promise<void> {
  const [supplier] = await tx
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.orgId, orgId)))
    .limit(1);
  if (!supplier) {
    throw new PurchaseDraftError(
      "VALIDATION_ERROR",
      "Supplier does not belong to this organization",
    );
  }
}

async function assertLocationBelongsToOrg(
  tx: DbTx,
  orgId: string,
  locationId: string,
): Promise<void> {
  const [location] = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.id, locationId), eq(locations.orgId, orgId)))
    .limit(1);
  if (!location) {
    throw new PurchaseDraftError(
      "VALIDATION_ERROR",
      "Location does not belong to this organization",
    );
  }
}

async function assertProductsBelongToOrg(
  tx: DbTx,
  orgId: string,
  productIds: string[],
): Promise<void> {
  productIds = [...new Set(productIds)];
  if (productIds.length) {
    const owned = await tx
      .select({ id: products.id })
      .from(products)
      .where(and(inArray(products.id, productIds), eq(products.orgId, orgId)));
    if (owned.length !== productIds.length) {
      // Deliberately does not name which id failed: the caller has already
      // proved it does not own these rows, and echoing back which of them exist
      // turns the error into an existence oracle for another tenant's catalogue.
      throw new PurchaseDraftError(
        "VALIDATION_ERROR",
        "One or more products do not belong to this organization",
      );
    }
  }
}

async function assertReferencesBelongToOrg(
  tx: DbTx,
  orgId: string,
  body: PurchaseDraftGroupInput,
): Promise<void> {
  await assertSupplierBelongsToOrg(tx, orgId, body.supplierId);
  await assertLocationBelongsToOrg(tx, orgId, body.locationId);
  await assertProductsBelongToOrg(
    tx,
    orgId,
    body.items.map((line) => line.productId),
  );
}

async function insertDraftWithItems(tx: DbTx, orgId: string, body: PurchaseDraftGroupInput) {
  if (!body.items.length) {
    throw new PurchaseDraftError("VALIDATION_ERROR", "At least one line item required");
  }

  await assertReferencesBelongToOrg(tx, orgId, body);

  const draftValues: PurchaseDraftInsert = {
    orgId,
    supplierId: body.supplierId,
    locationId: body.locationId,
    status: "draft",
    createdBy: body.createdBy,
    sourceRecommendationJson: body.sourceRecommendationJson ?? null,
  };
  const [draft] = await tx.insert(purchaseDrafts).values(draftValues).returning();

  for (const line of body.items) {
    if (line.quantity <= 0) {
      throw new PurchaseDraftError("VALIDATION_ERROR", "Quantity must be positive");
    }
    const itemValues: PurchaseDraftItemInsert = {
      purchaseDraftId: draft.id,
      orgId,
      productId: line.productId,
      quantity: line.quantity,
      estimatedCost: line.estimatedCost != null ? String(line.estimatedCost) : null,
      supplierSku: line.supplierSku,
    };
    await tx.insert(purchaseDraftItems).values(itemValues);
  }

  return loadDraftWithItems(orgId, draft.id, tx);
}

export async function createPurchaseDraft(orgId: string, body: PurchaseDraftGroupInput) {
  return db.transaction(async (tx) => insertDraftWithItems(tx, orgId, body));
}

/**
 * Creates one draft per group in a single transaction — a partially created
 * batch would leave the buyer reconciling drafts by hand, so all groups commit
 * together or none do.
 */
export async function createPurchaseDraftsBatch(
  orgId: string,
  groups: PurchaseDraftGroupInput[],
) {
  if (!groups.length) {
    throw new PurchaseDraftError("VALIDATION_ERROR", "At least one draft group required");
  }

  return db.transaction(async (tx) => {
    const created = [];
    for (const group of groups) {
      created.push(await insertDraftWithItems(tx, orgId, group));
    }
    return created;
  });
}

export async function updatePurchaseDraft(
  orgId: string,
  id: string,
  patch: { supplierId?: string; locationId?: string },
) {
  return db.transaction(async (tx) => {
    const existing = await loadDraftWithItems(orgId, id, tx);
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

    if (patch.supplierId !== undefined) {
      await assertSupplierBelongsToOrg(tx, orgId, patch.supplierId);
    }
    if (patch.locationId !== undefined) {
      await assertLocationBelongsToOrg(tx, orgId, patch.locationId);
    }

    await tx
      .update(purchaseDrafts)
      .set({
        ...(patch.supplierId !== undefined ? { supplierId: patch.supplierId } : {}),
        ...(patch.locationId !== undefined ? { locationId: patch.locationId } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(purchaseDrafts.id, id), eq(purchaseDrafts.orgId, orgId)));

    return loadDraftWithItems(orgId, id, tx);
  });
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
  return db.transaction(async (tx) => {
    const draft = await loadDraftWithItems(orgId, draftId, tx);
    if (!draft) throw new PurchaseDraftError("NOT_FOUND", "Purchase draft not found");
    if (
      draft.status === "cancelled" ||
      draft.status === "approved" ||
      draft.status === "partially_received" ||
      draft.status === "fully_received"
    ) {
      throw new PurchaseDraftError("INVALID_STATUS", "Cannot modify items in this status");
    }

    await assertProductsBelongToOrg(tx, orgId, [line.productId]);

    const addedValues: PurchaseDraftItemInsert = {
      purchaseDraftId: draftId,
      orgId,
      productId: line.productId,
      quantity: line.quantity,
      estimatedCost: line.estimatedCost != null ? String(line.estimatedCost) : null,
      supplierSku: line.supplierSku,
    };
    const [item] = await tx.insert(purchaseDraftItems).values(addedValues).returning();

    await tx
      .update(purchaseDrafts)
      .set({ updatedAt: new Date() })
      .where(and(eq(purchaseDrafts.id, draftId), eq(purchaseDrafts.orgId, orgId)));

    return item;
  });
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
