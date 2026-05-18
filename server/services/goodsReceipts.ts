import { db } from "../db";

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
import {
  goodsReceipts,
  goodsReceiptItems,
  purchaseDrafts,
  purchaseDraftItems,
  products,
  suppliers,
  locations,
} from "@shared/schema";
import { eq, and, desc, gte, lte, sql, ne } from "drizzle-orm";
import { randomUUID } from "crypto";
import { adjustProductLocationStock, StockError, stockErrorPayload } from "./productLocationStock";

export { StockError, stockErrorPayload };

export class GoodsReceiptError extends Error {
  code: string;
  details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function goodsReceiptErrorPayload(err: unknown) {
  if (err instanceof GoodsReceiptError) {
    return { code: err.code, message: err.message, details: err.details };
  }
  if (err instanceof StockError) {
    return stockErrorPayload(err);
  }
  return { code: "INTERNAL_ERROR", message: err instanceof Error ? err.message : "Unknown error" };
}

const RECEIVABLE_DRAFT_STATUSES = ["approved", "partially_received"];

function logCompletion(
  level: "info" | "warn" | "error",
  msg: string,
  meta: Record<string, unknown>,
) {
  const line = JSON.stringify({ component: "goods_receipt", level, message: msg, ...meta });
  if (level === "error") console.error(line);
  else console.log(line);
}

async function pendingQtyForDraftItem(
  purchaseDraftItemId: string,
  excludeReceiptId?: string,
  tx: DbTx | typeof db = db,
) {
  const conditions = [
    eq(goodsReceiptItems.purchaseDraftItemId, purchaseDraftItemId),
    eq(goodsReceipts.status, "pending"),
  ];
  if (excludeReceiptId) {
    conditions.push(ne(goodsReceipts.id, excludeReceiptId));
  }

  const [row] = await tx
    .select({
      total: sql<number>`COALESCE(SUM(${goodsReceiptItems.quantityReceived}), 0)::int`.as("total"),
    })
    .from(goodsReceiptItems)
    .innerJoin(goodsReceipts, eq(goodsReceiptItems.goodsReceiptId, goodsReceipts.id))
    .where(and(...conditions));

  return Number(row?.total) || 0;
}

async function loadReceipt(orgId: string, id: string, tx: DbTx | typeof db = db) {
  const [receipt] = await tx
    .select({
      id: goodsReceipts.id,
      orgId: goodsReceipts.orgId,
      purchaseDraftId: goodsReceipts.purchaseDraftId,
      locationId: goodsReceipts.locationId,
      status: goodsReceipts.status,
      supplierReference: goodsReceipts.supplierReference,
      deliveryNote: goodsReceipts.deliveryNote,
      receivedBy: goodsReceipts.receivedBy,
      receivedAt: goodsReceipts.receivedAt,
      createdAt: goodsReceipts.createdAt,
      updatedAt: goodsReceipts.updatedAt,
      supplierName: suppliers.name,
      locationName: locations.name,
    })
    .from(goodsReceipts)
    .innerJoin(purchaseDrafts, eq(goodsReceipts.purchaseDraftId, purchaseDrafts.id))
    .innerJoin(suppliers, eq(purchaseDrafts.supplierId, suppliers.id))
    .innerJoin(locations, eq(goodsReceipts.locationId, locations.id))
    .where(and(eq(goodsReceipts.id, id), eq(goodsReceipts.orgId, orgId)))
    .limit(1);

  if (!receipt) return null;

  const items = await tx
    .select({
      id: goodsReceiptItems.id,
      purchaseDraftItemId: goodsReceiptItems.purchaseDraftItemId,
      productId: goodsReceiptItems.productId,
      quantityReceived: goodsReceiptItems.quantityReceived,
      quantityDamaged: goodsReceiptItems.quantityDamaged,
      notes: goodsReceiptItems.notes,
      productName: products.name,
      sku: products.productId,
    })
    .from(goodsReceiptItems)
    .innerJoin(products, eq(goodsReceiptItems.productId, products.id))
    .where(eq(goodsReceiptItems.goodsReceiptId, id));

  return { ...receipt, items };
}

export async function listGoodsReceipts(
  orgId: string,
  filters: {
    status?: string;
    purchaseDraftId?: string;
    locationId?: string;
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
    offset?: number;
  },
) {
  const conditions = [eq(goodsReceipts.orgId, orgId)];
  if (filters.status) conditions.push(eq(goodsReceipts.status, filters.status));
  if (filters.purchaseDraftId) {
    conditions.push(eq(goodsReceipts.purchaseDraftId, filters.purchaseDraftId));
  }
  if (filters.locationId) conditions.push(eq(goodsReceipts.locationId, filters.locationId));
  if (filters.fromDate) conditions.push(gte(goodsReceipts.createdAt, filters.fromDate));
  if (filters.toDate) conditions.push(lte(goodsReceipts.createdAt, filters.toDate));

  const limit = Math.min(filters.limit ?? 50, 200);
  const offset = filters.offset ?? 0;

  const rows = await db
    .select({
      id: goodsReceipts.id,
      purchaseDraftId: goodsReceipts.purchaseDraftId,
      locationId: goodsReceipts.locationId,
      status: goodsReceipts.status,
      supplierReference: goodsReceipts.supplierReference,
      receivedBy: goodsReceipts.receivedBy,
      receivedAt: goodsReceipts.receivedAt,
      createdAt: goodsReceipts.createdAt,
      locationName: locations.name,
    })
    .from(goodsReceipts)
    .innerJoin(locations, eq(goodsReceipts.locationId, locations.id))
    .where(and(...conditions))
    .orderBy(desc(goodsReceipts.createdAt))
    .limit(limit)
    .offset(offset);

  return rows;
}

export async function getGoodsReceipt(orgId: string, id: string) {
  return loadReceipt(orgId, id);
}

export async function getPurchaseDraftReceiving(orgId: string, purchaseDraftId: string) {
  const [draft] = await db
    .select()
    .from(purchaseDrafts)
    .where(and(eq(purchaseDrafts.id, purchaseDraftId), eq(purchaseDrafts.orgId, orgId)))
    .limit(1);

  if (!draft) throw new GoodsReceiptError("NOT_FOUND", "Purchase draft not found");

  const items = await db
    .select({
      id: purchaseDraftItems.id,
      productId: purchaseDraftItems.productId,
      quantity: purchaseDraftItems.quantity,
      quantityReceived: purchaseDraftItems.quantityReceived,
      productName: products.name,
      sku: products.productId,
    })
    .from(purchaseDraftItems)
    .innerJoin(products, eq(purchaseDraftItems.productId, products.id))
    .where(eq(purchaseDraftItems.purchaseDraftId, purchaseDraftId));

  const enriched = await Promise.all(
    items.map(async (item) => {
      const pending = await pendingQtyForDraftItem(item.id);
      const already = item.quantityReceived ?? 0;
      const remaining = Math.max(0, item.quantity - already - pending);
      return {
        ...item,
        alreadyReceived: already,
        pendingOnReceipts: pending,
        remaining,
      };
    }),
  );

  const receipts = await listGoodsReceipts(orgId, { purchaseDraftId, limit: 100 });

  return {
    draft: {
      id: draft.id,
      status: draft.status,
      supplierId: draft.supplierId,
      locationId: draft.locationId,
    },
    items: enriched,
    receipts,
  };
}

async function validateReceiptLines(
  orgId: string,
  purchaseDraftId: string,
  lines: {
    purchaseDraftItemId: string;
    productId: string;
    quantityReceived: number;
    quantityDamaged?: number;
  }[],
  excludeReceiptId?: string,
  tx: DbTx | typeof db = db,
) {
  if (!lines.length) {
    throw new GoodsReceiptError("VALIDATION_ERROR", "At least one receipt line required");
  }

  const [draft] = await tx
    .select()
    .from(purchaseDrafts)
    .where(and(eq(purchaseDrafts.id, purchaseDraftId), eq(purchaseDrafts.orgId, orgId)))
    .limit(1);

  if (!draft) throw new GoodsReceiptError("NOT_FOUND", "Purchase draft not found");
  if (draft.status === "cancelled") {
    throw new GoodsReceiptError("DRAFT_CANCELLED", "Cannot receive against cancelled purchase draft");
  }
  if (!RECEIVABLE_DRAFT_STATUSES.includes(draft.status)) {
    throw new GoodsReceiptError(
      "DRAFT_NOT_RECEIVABLE",
      "Purchase draft must be approved or partially received",
      { status: draft.status },
    );
  }

  for (const line of lines) {
    if (line.quantityReceived <= 0) {
      throw new GoodsReceiptError("VALIDATION_ERROR", "quantityReceived must be > 0");
    }
    if ((line.quantityDamaged ?? 0) < 0) {
      throw new GoodsReceiptError("VALIDATION_ERROR", "quantityDamaged must be >= 0");
    }

    const [draftItem] = await tx
      .select()
      .from(purchaseDraftItems)
      .where(
        and(
          eq(purchaseDraftItems.id, line.purchaseDraftItemId),
          eq(purchaseDraftItems.purchaseDraftId, purchaseDraftId),
          eq(purchaseDraftItems.orgId, orgId),
        ),
      )
      .limit(1);

    if (!draftItem) {
      throw new GoodsReceiptError("LINE_NOT_FOUND", "Purchase draft line not found", {
        purchaseDraftItemId: line.purchaseDraftItemId,
      });
    }
    if (draftItem.productId !== line.productId) {
      throw new GoodsReceiptError("PRODUCT_MISMATCH", "Product does not match draft line");
    }

    const already = draftItem.quantityReceived ?? 0;
    const pending = await pendingQtyForDraftItem(line.purchaseDraftItemId, excludeReceiptId, tx);
    const remaining = draftItem.quantity - already - pending;

    if (line.quantityReceived > remaining) {
      throw new GoodsReceiptError(
        "OVER_RECEIVE",
        "Quantity exceeds remaining on purchase line",
        {
          purchaseDraftItemId: line.purchaseDraftItemId,
          ordered: draftItem.quantity,
          alreadyReceived: already,
          pendingOnOtherReceipts: pending,
          requested: line.quantityReceived,
          remaining,
        },
      );
    }
  }

  return draft;
}

export async function createGoodsReceipt(
  orgId: string,
  body: {
    purchaseDraftId: string;
    supplierReference?: string;
    deliveryNote?: string;
    items: {
      purchaseDraftItemId: string;
      productId: string;
      quantityReceived: number;
      quantityDamaged?: number;
      notes?: string;
    }[];
  },
) {
  const draft = await validateReceiptLines(orgId, body.purchaseDraftId, body.items);

  const receiptId = await db.transaction(async (tx) => {
    const [receipt] = await tx
      .insert(goodsReceipts)
      .values({
        orgId,
        purchaseDraftId: body.purchaseDraftId,
        locationId: draft.locationId,
        status: "pending",
        supplierReference: body.supplierReference,
        deliveryNote: body.deliveryNote,
      })
      .returning();

    for (const line of body.items) {
      await tx.insert(goodsReceiptItems).values({
        goodsReceiptId: receipt.id,
        purchaseDraftItemId: line.purchaseDraftItemId,
        productId: line.productId,
        quantityReceived: line.quantityReceived,
        quantityDamaged: line.quantityDamaged ?? 0,
        notes: line.notes,
      });
    }

    logCompletion("info", "pending_receipt_created", {
      orgId,
      receiptId: receipt.id,
      purchaseDraftId: body.purchaseDraftId,
      lineCount: body.items.length,
    });

    return receipt.id;
  });

  return loadReceipt(orgId, receiptId!);
}

export async function completeGoodsReceipt(
  orgId: string,
  receiptId: string,
  receivedBy?: string,
) {
  const correlationId = receiptId;
  const completionEventId = `goods_receipt_complete:${receiptId}`;

  try {
    const result = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(goodsReceipts)
        .where(and(eq(goodsReceipts.id, receiptId), eq(goodsReceipts.orgId, orgId)))
        .for("update")
        .limit(1);

      if (!locked) throw new GoodsReceiptError("NOT_FOUND", "Goods receipt not found");
      if (locked.status === "completed") {
        logCompletion("info", "completion_already_completed", { orgId, receiptId });
        return { receipt: await loadReceipt(orgId, receiptId, tx), idempotent: true };
      }
      if (locked.status === "voided") {
        throw new GoodsReceiptError("INVALID_STATUS", "Cannot complete voided receipt");
      }
      if (locked.status !== "pending") {
        throw new GoodsReceiptError("INVALID_STATUS", `Cannot complete receipt in status ${locked.status}`);
      }

      const items = await tx
        .select()
        .from(goodsReceiptItems)
        .where(eq(goodsReceiptItems.goodsReceiptId, receiptId));

      if (!items.length) {
        throw new GoodsReceiptError("VALIDATION_ERROR", "Receipt has no line items");
      }

      const lineInputs = items.map((i) => ({
        purchaseDraftItemId: i.purchaseDraftItemId,
        productId: i.productId,
        quantityReceived: i.quantityReceived,
        quantityDamaged: i.quantityDamaged,
      }));

      const draft = await validateReceiptLines(
        orgId,
        locked.purchaseDraftId,
        lineInputs,
        receiptId,
        tx,
      );

      const [draftRow] = await tx
        .select({ supplierId: purchaseDrafts.supplierId })
        .from(purchaseDrafts)
        .where(eq(purchaseDrafts.id, locked.purchaseDraftId))
        .limit(1);

      for (const line of items) {
        const [draftItem] = await tx
          .select()
          .from(purchaseDraftItems)
          .where(eq(purchaseDraftItems.id, line.purchaseDraftItemId))
          .for("update")
          .limit(1);

        if (!draftItem) {
          throw new GoodsReceiptError("LINE_NOT_FOUND", "Draft line missing on complete");
        }

        const newReceived = (draftItem.quantityReceived ?? 0) + line.quantityReceived;
        if (newReceived > draftItem.quantity) {
          throw new GoodsReceiptError("OVER_RECEIVE", "Would exceed ordered quantity on complete", {
            purchaseDraftItemId: line.purchaseDraftItemId,
            ordered: draftItem.quantity,
            newReceived,
          });
        }

        const [product] = await tx
          .select({ productId: products.productId })
          .from(products)
          .where(eq(products.id, line.productId))
          .limit(1);

        await adjustProductLocationStock(
          {
            orgId,
            productId: line.productId,
            locationId: locked.locationId,
            delta: line.quantityReceived,
            movement: {
              reason: "goods_receipt",
              correlationId,
              eventId: `${completionEventId}:${line.id}`,
              sku: product?.productId ?? line.productId,
              goodsReceiptId: receiptId,
              purchaseDraftId: locked.purchaseDraftId,
              supplierId: draftRow?.supplierId,
            },
          },
          tx,
        );

        await tx
          .update(purchaseDraftItems)
          .set({ quantityReceived: newReceived })
          .where(eq(purchaseDraftItems.id, line.purchaseDraftItemId));
      }

      const allDraftItems = await tx
        .select()
        .from(purchaseDraftItems)
        .where(eq(purchaseDraftItems.purchaseDraftId, locked.purchaseDraftId));

      const fullyReceived = allDraftItems.every(
        (i) => (i.quantityReceived ?? 0) >= i.quantity,
      );
      const anyReceived = allDraftItems.some((i) => (i.quantityReceived ?? 0) > 0);

      let draftStatus = draft.status;
      if (fullyReceived) draftStatus = "fully_received";
      else if (anyReceived) draftStatus = "partially_received";

      await tx
        .update(purchaseDrafts)
        .set({ status: draftStatus, updatedAt: new Date() })
        .where(eq(purchaseDrafts.id, locked.purchaseDraftId));

      const now = new Date();
      await tx
        .update(goodsReceipts)
        .set({
          status: "completed",
          receivedBy: receivedBy ?? locked.receivedBy,
          receivedAt: now,
          updatedAt: now,
        })
        .where(eq(goodsReceipts.id, receiptId));

      logCompletion("info", "completion_success", {
        orgId,
        receiptId,
        purchaseDraftId: locked.purchaseDraftId,
        draftStatus,
        lineCount: items.length,
        correlationId,
      });

      return { receipt: await loadReceipt(orgId, receiptId, tx), idempotent: false };
    });

    return result;
  } catch (err) {
    logCompletion("error", "completion_failed", {
      orgId,
      receiptId,
      reason: err instanceof Error ? err.message : "unknown",
      code: err instanceof GoodsReceiptError ? err.code : "INTERNAL_ERROR",
    });
    throw err;
  }
}

export async function voidGoodsReceipt(orgId: string, receiptId: string) {
  const [row] = await db
    .update(goodsReceipts)
    .set({ status: "voided", updatedAt: new Date() })
    .where(
      and(
        eq(goodsReceipts.id, receiptId),
        eq(goodsReceipts.orgId, orgId),
        eq(goodsReceipts.status, "pending"),
      ),
    )
    .returning();

  if (!row) {
    const existing = await loadReceipt(orgId, receiptId);
    if (!existing) throw new GoodsReceiptError("NOT_FOUND", "Goods receipt not found");
    if (existing.status === "completed") {
      throw new GoodsReceiptError("INVALID_STATUS", "Cannot void completed receipt");
    }
    if (existing.status === "voided") {
      return existing;
    }
    throw new GoodsReceiptError("INVALID_STATUS", "Only pending receipts can be voided");
  }

  logCompletion("info", "receipt_voided", { orgId, receiptId });
  return loadReceipt(orgId, receiptId);
}
