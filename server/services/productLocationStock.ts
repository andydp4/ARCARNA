/**
 * Authoritative per-location stock (product_location_stock).
 * products.stock is legacy display-only — written as 0 when syncing compatibility placeholder.
 */
import { db } from "../db";
import {
  products,
  locations,
  productLocationStock,
  inventoryMovements,
  users,
  orders,
} from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type StockLocationContext = {
  orgId: string;
  locationId?: string | null;
  orderId?: string | null;
  userId?: string | null;
};

export type MovementMeta = {
  reason: string;
  correlationId: string;
  eventId: string;
  sku: string;
  transferId?: string;
  fromLocationId?: string;
  toLocationId?: string;
  goodsReceiptId?: string;
  purchaseDraftId?: string;
  supplierId?: string;
};

export class StockError extends Error {
  code: string;
  details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function stockErrorPayload(err: unknown): { code: string; message: string; details?: unknown } {
  if (err instanceof StockError) {
    return { code: err.code, message: err.message, details: err.details };
  }
  return { code: "INTERNAL_ERROR", message: err instanceof Error ? err.message : "Unknown error" };
}

/** Legacy compatibility — not authoritative. */
export async function syncLegacyProductStockPlaceholder(
  productId: string,
  tx: DbTx | typeof db = db,
): Promise<void> {
  await tx
    .update(products)
    .set({ stock: 0, updatedAt: new Date() })
    .where(eq(products.id, productId));
}

export async function resolveStockLocationId(
  ctx: StockLocationContext,
  tx: DbTx | typeof db = db,
): Promise<string> {
  if (ctx.locationId) {
    const [loc] = await tx
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.id, ctx.locationId), eq(locations.orgId, ctx.orgId)))
      .limit(1);
    if (!loc) throw new StockError("LOCATION_NOT_FOUND", "Location not found for org");
    return loc.id;
  }

  if (ctx.orderId) {
    const [order] = await tx
      .select({ locationId: orders.locationId })
      .from(orders)
      .where(and(eq(orders.id, ctx.orderId), eq(orders.orgId, ctx.orgId)))
      .limit(1);
    if (order?.locationId) return order.locationId;
  }

  if (ctx.userId) {
    const [user] = await tx
      .select({ defaultLocationId: users.defaultLocationId })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1);
    if (user?.defaultLocationId) {
      const [loc] = await tx
        .select({ id: locations.id })
        .from(locations)
        .where(and(eq(locations.id, user.defaultLocationId), eq(locations.orgId, ctx.orgId)))
        .limit(1);
      if (loc) return loc.id;
    }
  }

  const [defaultLoc] = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.orgId, ctx.orgId), eq(locations.isDefault, 1), eq(locations.isActive, 1)))
    .limit(1);
  if (defaultLoc) return defaultLoc.id;

  const [firstLoc] = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.orgId, ctx.orgId), eq(locations.isActive, 1)))
    .limit(1);
  if (firstLoc) return firstLoc.id;

  throw new StockError(
    "LOCATION_UNRESOLVED",
    "Could not resolve stock location (explicit, order, user default, or org default required)",
    { orgId: ctx.orgId },
  );
}

export async function getProductLocationStock(
  orgId: string,
  productId: string,
  locationId: string,
  tx: DbTx | typeof db = db,
) {
  const [row] = await tx
    .select()
    .from(productLocationStock)
    .where(
      and(
        eq(productLocationStock.orgId, orgId),
        eq(productLocationStock.productId, productId),
        eq(productLocationStock.locationId, locationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getProductStockTotal(orgId: string, productId: string): Promise<number> {
  const rows = await db
    .select({ stock: productLocationStock.stock })
    .from(productLocationStock)
    .where(and(eq(productLocationStock.orgId, orgId), eq(productLocationStock.productId, productId)));
  return rows.reduce((s, r) => s + (r.stock ?? 0), 0);
}

export async function ensureProductLocationStockRow(
  orgId: string,
  productId: string,
  locationId: string,
  initialStock = 0,
  stockLimit = 10,
  tx: DbTx | typeof db = db,
) {
  const existing = await getProductLocationStock(orgId, productId, locationId, tx);
  if (existing) return existing;

  const [product] = await tx.select().from(products).where(eq(products.id, productId)).limit(1);
  const limit = product?.stockLimit ?? stockLimit;

  const [inserted] = await tx
    .insert(productLocationStock)
    .values({
      orgId,
      productId,
      locationId,
      stock: initialStock,
      stockLimit: limit,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted) return inserted;

  return (await getProductLocationStock(orgId, productId, locationId, tx))!;
}

export type AdjustResult = {
  previousStock: number;
  newStock: number;
  row: typeof productLocationStock.$inferSelect;
};

export async function adjustProductLocationStock(
  args: {
    orgId: string;
    productId: string;
    locationId: string;
    delta?: number;
    allowNegative?: boolean;
    setStock?: number;
    movement?: MovementMeta;
  },
  tx?: DbTx,
): Promise<AdjustResult> {
  const run = async (client: DbTx) => {
    await ensureProductLocationStockRow(args.orgId, args.productId, args.locationId, 0, 10, client);

    const before = await getProductLocationStock(args.orgId, args.productId, args.locationId, client);
    if (!before) throw new StockError("STOCK_ROW_MISSING", "Product location stock row not found");

    const previousStock = before.stock ?? 0;
    let updated: typeof productLocationStock.$inferSelect | undefined;

    if (args.setStock !== undefined) {
      if (!args.allowNegative && args.setStock < 0) {
        throw new StockError("INSUFFICIENT_STOCK", "Insufficient stock at location", {
          productId: args.productId,
          locationId: args.locationId,
          previousStock,
        });
      }
      [updated] = await client
        .update(productLocationStock)
        .set({ stock: args.setStock, updatedAt: new Date() })
        .where(eq(productLocationStock.id, before.id))
        .returning();
    } else if ((args.delta ?? 0) < 0 && !args.allowNegative) {
      [updated] = await client
        .update(productLocationStock)
        .set({
          stock: sql`${productLocationStock.stock} + ${args.delta ?? 0}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(productLocationStock.id, before.id),
            sql`${productLocationStock.stock} + ${args.delta} >= 0`,
          ),
        )
        .returning();
      if (!updated) {
        throw new StockError("INSUFFICIENT_STOCK", "Insufficient stock at location", {
          productId: args.productId,
          locationId: args.locationId,
          previousStock,
          requestedDelta: args.delta,
        });
      }
    } else {
      [updated] = await client
        .update(productLocationStock)
        .set({
          stock: sql`${productLocationStock.stock} + ${args.delta ?? 0}`,
          updatedAt: new Date(),
        })
        .where(eq(productLocationStock.id, before.id))
        .returning();
    }

    if (!updated) throw new StockError("STOCK_UPDATE_FAILED", "Stock update failed");

    const newStock = updated.stock ?? 0;

    if (args.movement) {
      await client.insert(inventoryMovements).values({
        orgId: args.orgId,
        sku: args.movement.sku,
        productId: args.productId,
        delta: args.setStock !== undefined ? newStock - previousStock : (args.delta ?? 0),
        reason: args.movement.reason,
        correlationId: args.movement.correlationId,
        eventId: args.movement.eventId,
        previousStock,
        newStock,
        locationId: args.locationId,
        transferId: args.movement.transferId,
        fromLocationId: args.movement.fromLocationId,
        toLocationId: args.movement.toLocationId,
        goodsReceiptId: args.movement.goodsReceiptId,
        purchaseDraftId: args.movement.purchaseDraftId,
        supplierId: args.movement.supplierId,
      });
    }

    await syncLegacyProductStockPlaceholder(args.productId, client);

    return { previousStock, newStock, row: updated! };
  };

  if (tx) return run(tx);
  return db.transaction(run);
}

export async function getInventoryByLocation(orgId: string, locationId?: string) {
  const cond = locationId
    ? and(eq(productLocationStock.orgId, orgId), eq(productLocationStock.locationId, locationId))
    : eq(productLocationStock.orgId, orgId);

  return db
    .select({
      id: productLocationStock.id,
      productId: productLocationStock.productId,
      locationId: productLocationStock.locationId,
      stock: productLocationStock.stock,
      stockLimit: productLocationStock.stockLimit,
      productName: products.name,
      sku: products.productId,
    })
    .from(productLocationStock)
    .innerJoin(products, eq(productLocationStock.productId, products.id))
    .where(cond)
    .orderBy(products.name);
}

export async function resolveProductLocationForBackfill(
  orgId: string,
  product: { id: string; locationId: string | null; stock: number | null; stockLimit: number | null },
): Promise<{ locationId: string } | { skip: true; reason: string }> {
  if (product.locationId) {
    const [loc] = await db
      .select()
      .from(locations)
      .where(and(eq(locations.id, product.locationId), eq(locations.orgId, orgId)))
      .limit(1);
    if (loc) return { locationId: loc.id };
  }

  const [defaultLoc] = await db
    .select()
    .from(locations)
    .where(and(eq(locations.orgId, orgId), eq(locations.isDefault, 1)))
    .limit(1);
  if (defaultLoc) return { locationId: defaultLoc.id };

  const [firstLoc] = await db
    .select()
    .from(locations)
    .where(eq(locations.orgId, orgId))
    .limit(1);
  if (firstLoc) return { locationId: firstLoc.id };

  return { skip: true, reason: `No location for product ${product.id}` };
}
