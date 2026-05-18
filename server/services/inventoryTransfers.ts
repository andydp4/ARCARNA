import { db } from "../db";
import {
  inventoryTransfers,
  inventoryTransferItems,
  products,
  locations,
} from "@shared/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  adjustProductLocationStock,
  StockError,
  stockErrorPayload,
} from "./productLocationStock";

export { StockError, stockErrorPayload };

export type TransferStatus = "draft" | "requested" | "in_transit" | "completed" | "cancelled";

const TERMINAL: TransferStatus[] = ["completed", "cancelled"];

const ALLOWED: Record<TransferStatus, TransferStatus[]> = {
  draft: ["requested", "cancelled"],
  requested: ["in_transit", "cancelled"],
  in_transit: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export class TransferError extends Error {
  code: string;
  details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function transferErrorPayload(err: unknown) {
  if (err instanceof TransferError) {
    return { code: err.code, message: err.message, details: err.details };
  }
  if (err instanceof StockError) {
    return stockErrorPayload(err);
  }
  return { code: "INTERNAL_ERROR", message: err instanceof Error ? err.message : "Unknown error" };
}

async function assertLocationInOrg(orgId: string, locationId: string) {
  const [loc] = await db
    .select()
    .from(locations)
    .where(and(eq(locations.id, locationId), eq(locations.orgId, orgId)))
    .limit(1);
  if (!loc) throw new TransferError("LOCATION_NOT_FOUND", "Location not found in org");
  return loc;
}

async function assertProductInOrg(orgId: string, productId: string) {
  const [p] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.orgId, orgId)))
    .limit(1);
  if (!p) throw new TransferError("PRODUCT_NOT_FOUND", "Product not found in org");
  return p;
}

export async function listTransfers(orgId: string) {
  const rows = await db
    .select()
    .from(inventoryTransfers)
    .where(eq(inventoryTransfers.orgId, orgId))
    .orderBy(desc(inventoryTransfers.updatedAt));

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const items = await db
    .select()
    .from(inventoryTransferItems)
    .where(inArray(inventoryTransferItems.transferId, ids));

  const byTransfer = new Map<string, typeof items>();
  for (const item of items) {
    const list = byTransfer.get(item.transferId) ?? [];
    list.push(item);
    byTransfer.set(item.transferId, list);
  }

  return rows.map((t) => ({ ...t, items: byTransfer.get(t.id) ?? [] }));
}

export async function getTransfer(orgId: string, transferId: string) {
  const [transfer] = await db
    .select()
    .from(inventoryTransfers)
    .where(and(eq(inventoryTransfers.id, transferId), eq(inventoryTransfers.orgId, orgId)))
    .limit(1);
  if (!transfer) return null;

  const items = await db
    .select({
      id: inventoryTransferItems.id,
      productId: inventoryTransferItems.productId,
      quantity: inventoryTransferItems.quantity,
      productName: products.name,
      sku: products.productId,
    })
    .from(inventoryTransferItems)
    .innerJoin(products, eq(inventoryTransferItems.productId, products.id))
    .where(eq(inventoryTransferItems.transferId, transferId));

  return { ...transfer, items };
}

export async function createTransfer(
  orgId: string,
  body: {
    fromLocationId: string;
    toLocationId: string;
    notes?: string;
    requestedBy?: string;
    items: { productId: string; quantity: number }[];
  },
) {
  if (body.fromLocationId === body.toLocationId) {
    throw new TransferError("INVALID_LOCATIONS", "Source and destination must differ");
  }
  await assertLocationInOrg(orgId, body.fromLocationId);
  await assertLocationInOrg(orgId, body.toLocationId);

  if (!body.items?.length) {
    throw new TransferError("INVALID_ITEMS", "At least one line item required");
  }

  for (const line of body.items) {
    if (line.quantity <= 0) {
      throw new TransferError("INVALID_QUANTITY", "Quantity must be greater than zero", { line });
    }
    await assertProductInOrg(orgId, line.productId);
  }

  const correlationId = randomUUID();

  const createdId = await db.transaction(async (tx) => {
    const [transfer] = await tx
      .insert(inventoryTransfers)
      .values({
        orgId,
        fromLocationId: body.fromLocationId,
        toLocationId: body.toLocationId,
        status: "draft",
        notes: body.notes,
        requestedBy: body.requestedBy,
        correlationId,
      })
      .returning();

    for (const line of body.items) {
      await tx.insert(inventoryTransferItems).values({
        transferId: transfer.id,
        productId: line.productId,
        quantity: line.quantity,
      });
    }

    console.log(
      `[Transfer] created ${transfer.id} org=${orgId} ${body.fromLocationId} -> ${body.toLocationId}`,
    );

    return transfer.id;
  });

  return getTransfer(orgId, createdId!);
}

async function completeTransfer(
  orgId: string,
  transfer: typeof inventoryTransfers.$inferSelect,
  items: { productId: string; quantity: number; sku: string }[],
) {
  if (transfer.status === "completed") {
    throw new TransferError("ALREADY_COMPLETED", "Transfer already completed", { transferId: transfer.id });
  }

  const eventId = randomUUID();
  const correlationId = transfer.correlationId || transfer.id;

  await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(inventoryTransfers)
      .where(and(eq(inventoryTransfers.id, transfer.id), eq(inventoryTransfers.orgId, orgId)))
      .limit(1);

    if (!locked || locked.status === "completed") {
      throw new TransferError("ALREADY_COMPLETED", "Transfer already completed");
    }
    if (locked.status !== "in_transit") {
      throw new TransferError("INVALID_STATUS", "Transfer must be in_transit to complete");
    }

    for (const line of items) {
      const [p] = await tx
        .select({ productId: products.productId })
        .from(products)
        .where(eq(products.id, line.productId))
        .limit(1);

      await adjustProductLocationStock(
        {
          orgId,
          productId: line.productId,
          locationId: transfer.fromLocationId,
          delta: -line.quantity,
          allowNegative: false,
          movement: {
            reason: "transfer_out",
            correlationId,
            eventId,
            sku: p?.productId || line.productId,
            transferId: transfer.id,
            fromLocationId: transfer.fromLocationId,
            toLocationId: transfer.toLocationId,
          },
        },
        tx,
      );

      await adjustProductLocationStock(
        {
          orgId,
          productId: line.productId,
          locationId: transfer.toLocationId,
          delta: line.quantity,
          movement: {
            reason: "transfer_in",
            correlationId,
            eventId,
            sku: p?.productId || line.productId,
            transferId: transfer.id,
            fromLocationId: transfer.fromLocationId,
            toLocationId: transfer.toLocationId,
          },
        },
        tx,
      );
    }

    await tx
      .update(inventoryTransfers)
      .set({
        status: "completed",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(inventoryTransfers.id, transfer.id),
          eq(inventoryTransfers.status, "in_transit"),
        ),
      );
  });

  console.log(`[Transfer] completed ${transfer.id} org=${orgId} items=${items.length}`);
}

export async function updateTransferStatus(
  orgId: string,
  transferId: string,
  nextStatus: TransferStatus,
) {
  const full = await getTransfer(orgId, transferId);
  if (!full) throw new TransferError("NOT_FOUND", "Transfer not found");

  const current = full.status as TransferStatus;
  if (TERMINAL.includes(current)) {
    throw new TransferError("TERMINAL_STATUS", `Transfer is ${current} and cannot change`);
  }

  const allowed = ALLOWED[current];
  if (!allowed.includes(nextStatus)) {
    throw new TransferError("INVALID_TRANSITION", `Cannot transition ${current} -> ${nextStatus}`, {
      from: current,
      to: nextStatus,
      allowed,
    });
  }

  if (nextStatus === "completed") {
    const itemRows = await db
      .select({
        productId: inventoryTransferItems.productId,
        quantity: inventoryTransferItems.quantity,
        sku: products.productId,
      })
      .from(inventoryTransferItems)
      .innerJoin(products, eq(inventoryTransferItems.productId, products.id))
      .where(eq(inventoryTransferItems.transferId, transferId));

    await completeTransfer(orgId, full, itemRows);
    return getTransfer(orgId, transferId);
  }

  const patch: Partial<typeof inventoryTransfers.$inferInsert> = {
    status: nextStatus,
    updatedAt: new Date(),
  };
  if (nextStatus === "cancelled") patch.cancelledAt = new Date();

  await db
    .update(inventoryTransfers)
    .set(patch)
    .where(and(eq(inventoryTransfers.id, transferId), eq(inventoryTransfers.orgId, orgId)));

  console.log(`[Transfer] status ${transferId}: ${current} -> ${nextStatus}`);

  return getTransfer(orgId, transferId);
}
