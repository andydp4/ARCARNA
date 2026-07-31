/**
 * Phase 6.6 — Reconciliation. `product_location_stock.stock` must equal the sum
 * of `inventory_movements.delta` for that product+location.
 *
 * The invariant holds exactly when every unit that ever entered or left a
 * product+location did so through `adjustProductLocationStock`, which is the
 * only writer that also appends to the movement ledger. There is one legitimate
 * exception, and this file pins it down rather than hand-waving it: an OPENING
 * BALANCE written straight into `product_location_stock` (the shape used by
 * seeds, imports and backfills) is never represented in the ledger, so for such
 * rows the invariant is `opening + sum(delta) = stock`. A pair that has ledger
 * rows and still does not reconcile is a genuine defect.
 *
 * Requires DATABASE_URL (imports ../db at module level) → must be added to the
 * `exclude` list in vitest.config.ts for the no-DB run.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, inArray, sql, notLike, isNull, or } from "drizzle-orm";
import { db } from "../db";
import {
  organizations,
  locations,
  products,
  suppliers,
  productLocationStock,
  purchaseDrafts,
  goodsReceipts,
  inventoryMovements,
  inventoryTransfers,
  orders,
  orderItems,
  eventOutbox,
} from "@shared/schema";
import { createPurchaseDraftsBatch, setPurchaseDraftStatus } from "../services/purchaseDrafts";
import {
  createGoodsReceipt,
  completeGoodsReceipt,
  getPurchaseDraftReceiving,
} from "../services/goodsReceipts";
import { createTransfer, updateTransferStatus } from "../services/inventoryTransfers";
import { adjustProductLocationStock } from "../services/productLocationStock";
import { InventoryWorker } from "../workers/inventoryWorker";
import type { EventEnvelope } from "@shared/schema";

const hasDb = !!process.env.DATABASE_URL;

const createdOrgIds: string[] = [];
const createdCorrelationIds: string[] = [];

let orgId: string;
let locationId: string;
let altLocationId: string;
let supplierId: string;

type Pair = {
  productId: string;
  locationId: string;
  orgName: string | null;
  stock: number;
  /** SUM(inventory_movements.delta) for this product+location. */
  ledger: number;
  moves: number;
  /** previous_stock recorded on the EARLIEST movement — the unlogged opening. */
  opening: number | null;
  /** new_stock recorded on the LATEST movement. */
  closing: number | null;
};

/**
 * The reconciliation query, written as raw SQL so the per-pair correlation is
 * unambiguous. Optionally narrowed to one org.
 */
async function reconcile(scopeOrgId?: string): Promise<Pair[]> {
  const result = await db.execute(sql`
    WITH agg AS (
      SELECT
        m.product_id,
        m.location_id,
        SUM(m.delta)::int                          AS ledger,
        COUNT(*)::int                              AS moves,
        (ARRAY_AGG(m.previous_stock ORDER BY m.created_at ASC, m.movement_id ASC))[1]  AS opening,
        (ARRAY_AGG(m.new_stock      ORDER BY m.created_at DESC, m.movement_id DESC))[1] AS closing
      FROM inventory_movements m
      WHERE m.product_id IS NOT NULL AND m.location_id IS NOT NULL
      GROUP BY m.product_id, m.location_id
    )
    SELECT
      s.product_id            AS "productId",
      s.location_id           AS "locationId",
      o.name                  AS "orgName",
      s.stock                 AS "stock",
      COALESCE(agg.ledger, 0) AS "ledger",
      COALESCE(agg.moves, 0)  AS "moves",
      agg.opening             AS "opening",
      agg.closing             AS "closing"
    FROM product_location_stock s
    LEFT JOIN agg ON agg.product_id = s.product_id AND agg.location_id = s.location_id
    LEFT JOIN organizations o ON o.id = s.org_id
    ${scopeOrgId ? sql`WHERE s.org_id = ${scopeOrgId}` : sql``}
  `);

  const rows = (result as unknown as { rows: Record<string, unknown>[] }).rows;
  return rows.map((r) => ({
    productId: String(r.productId),
    locationId: String(r.locationId),
    orgName: r.orgName == null ? null : String(r.orgName),
    stock: Number(r.stock ?? 0),
    ledger: Number(r.ledger ?? 0),
    moves: Number(r.moves ?? 0),
    opening: r.opening == null ? null : Number(r.opening),
    closing: r.closing == null ? null : Number(r.closing),
  }));
}

async function makeOrg(name: string) {
  const [org] = await db.insert(organizations).values({ name }).returning();
  createdOrgIds.push(org.id);
  return org.id;
}

async function makeLocation(org: string, name: string, isDefault = 0) {
  const [loc] = await db
    .insert(locations)
    .values({
      orgId: org,
      name,
      address: "1 Ledger Lane",
      city: "Testville",
      state: "TS",
      zipCode: "TS1",
      phone: "0000000000",
      email: "loc@example.com",
      isDefault,
    })
    .returning();
  return loc.id;
}

/** A product with NO opening balance: every unit must arrive via the ledger. */
async function makeLedgerOnlyProduct(name: string) {
  const [p] = await db
    .insert(products)
    .values({
      orgId,
      locationId,
      name,
      productId: `RC-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      defaultSalePrice: "10.00",
    })
    .returning();
  return p.id;
}

async function receiveStock(productId: string, qty: number) {
  const [draft] = await createPurchaseDraftsBatch(orgId, [
    { supplierId, locationId, items: [{ productId, quantity: qty }] },
  ]);
  await setPurchaseDraftStatus(orgId, draft!.id, "reviewed");
  await setPurchaseDraftStatus(orgId, draft!.id, "approved");
  const receiving = await getPurchaseDraftReceiving(orgId, draft!.id);
  const receipt = await createGoodsReceipt(orgId, {
    purchaseDraftId: draft!.id,
    items: [
      { purchaseDraftItemId: receiving.items[0].id, productId, quantityReceived: qty },
    ],
  });
  await completeGoodsReceipt(orgId, receipt!.id, "recon");
}

beforeAll(async () => {
  if (!hasDb) return;
  // Deliberately NOT prefixed "Integrity " — see the global audit test below.
  orgId = await makeOrg(`Recon Exercise ${Date.now()}`);
  locationId = await makeLocation(orgId, "Recon Main", 1);
  altLocationId = await makeLocation(orgId, "Recon Annex");
  supplierId = (
    await db
      .insert(suppliers)
      .values({ orgId, name: "Recon Supplier", leadTimeDays: 1, isActive: 1 })
      .returning()
  )[0].id;
});

afterAll(async () => {
  if (!hasDb || !createdOrgIds.length) return;
  const inOrgs = createdOrgIds;
  if (createdCorrelationIds.length) {
    await db
      .delete(eventOutbox)
      .where(inArray(eventOutbox.correlationId, createdCorrelationIds));
  }
  await db.delete(inventoryMovements).where(inArray(inventoryMovements.orgId, inOrgs));
  await db.delete(orderItems).where(inArray(orderItems.orgId, inOrgs));
  await db.delete(orders).where(inArray(orders.orgId, inOrgs));
  await db.delete(inventoryTransfers).where(inArray(inventoryTransfers.orgId, inOrgs));
  await db.delete(goodsReceipts).where(inArray(goodsReceipts.orgId, inOrgs));
  await db.delete(purchaseDrafts).where(inArray(purchaseDrafts.orgId, inOrgs));
  await db.delete(productLocationStock).where(inArray(productLocationStock.orgId, inOrgs));
  await db.delete(products).where(inArray(products.orgId, inOrgs));
  await db.delete(suppliers).where(inArray(suppliers.orgId, inOrgs));
  await db.delete(locations).where(inArray(locations.orgId, inOrgs));
  await db.delete(organizations).where(inArray(organizations.id, inOrgs));
});

describe.skipIf(!hasDb)("6.6 stock reconciles to the movement ledger", () => {
  it("holds exactly across a full exercise: receive, transfer, sell, refund, adjust", async () => {
    const productId = await makeLedgerOnlyProduct("full");

    // 1. Receive 10 through the purchasing pipeline.
    await receiveStock(productId, 10);

    // 2. Transfer 4 to the annex (two ledger legs).
    const transfer = await createTransfer(orgId, {
      fromLocationId: locationId,
      toLocationId: altLocationId,
      items: [{ productId, quantity: 4 }],
    });
    await updateTransferStatus(orgId, transfer!.id, "requested");
    await updateTransferStatus(orgId, transfer!.id, "in_transit");
    await updateTransferStatus(orgId, transfer!.id, "completed");

    // 3. Sell 3 through the InventoryWorker (the production POS path).
    const [order] = await db
      .insert(orders)
      .values({
        orgId,
        locationId,
        total: "30.00",
        settledTotal: "30.00",
        paymentMethod: "cash",
        status: "completed",
      })
      .returning();
    createdCorrelationIds.push(order.id);
    await db.insert(orderItems).values({
      orgId,
      orderId: order.id,
      productId,
      quantity: 3,
      unitPrice: "10.00",
      totalPrice: "30.00",
    });
    const worker = new InventoryWorker();
    await worker.handle({
      eventId: `recon-sale-${order.id}`,
      eventType: "OrderCreated",
      occurredAt: new Date().toISOString(),
      correlationId: order.id,
      actor: { type: "system", id: "test" },
      source: "test",
      version: 1,
      payload: {
        orderId: order.id,
        orgId,
        items: [{ productId, name: "full", qty: 3, unitPrice: 10 }],
      },
    } as unknown as EventEnvelope);

    // 4. Refund one unit back.
    await worker.handle({
      eventId: `recon-refund-${order.id}`,
      eventType: "RefundIssued",
      occurredAt: new Date().toISOString(),
      correlationId: order.id,
      actor: { type: "system", id: "test" },
      source: "test",
      version: 1,
      payload: { orderId: order.id, orgId, lines: [{ lineId: "l1", qty: 1, productId }] },
    } as unknown as EventEnvelope);

    // 5. A manual shrinkage adjustment.
    await adjustProductLocationStock({
      orgId,
      productId,
      locationId,
      delta: -2,
      movement: {
        reason: "adjustment",
        correlationId: `recon-adj-${productId}`,
        eventId: `recon-adj-${productId}`,
        sku: "RC",
      },
    });

    const pairs = await reconcile(orgId);
    const main = pairs.find((p) => p.productId === productId && p.locationId === locationId)!;
    const annex = pairs.find(
      (p) => p.productId === productId && p.locationId === altLocationId,
    )!;

    // Arithmetic the invariant must reproduce: +10 -4 -3 +1 -2 = 2 at main, 4 at annex.
    expect(main.stock).toBe(2);
    expect(annex.stock).toBe(4);
    expect(main.ledger).toBe(main.stock);
    expect(annex.ledger).toBe(annex.stock);
    // Sanity: the ledger is not empty (an all-zero ledger would satisfy the
    // equality vacuously for a product with zero stock).
    expect(main.moves).toBe(5);
    expect(annex.moves).toBe(1);
  });

  it("holds for every product+location in an org whose whole life is ledger-driven", async () => {
    const a = await makeLedgerOnlyProduct("orgA");
    const b = await makeLedgerOnlyProduct("orgB");
    await receiveStock(a, 6);
    await receiveStock(b, 9);
    await adjustProductLocationStock({
      orgId,
      productId: b,
      locationId,
      delta: -4,
      movement: {
        reason: "adjustment",
        correlationId: `recon-b-${b}`,
        eventId: `recon-b-${b}`,
        sku: "RC",
      },
    });

    const pairs = (await reconcile(orgId)).filter((p) => [a, b].includes(p.productId));
    expect(pairs.length).toBeGreaterThanOrEqual(2);
    const broken = pairs.filter((p) => p.stock !== p.ledger);
    expect(broken).toEqual([]);
  });

  it("documents the one legitimate exception: an unlogged opening balance", async () => {
    // This is the shape produced by seeds/imports/backfills — a stock row
    // written directly, with no corresponding movement. The invariant becomes
    // `opening + sum(delta) = stock`, and the shortfall is EXACTLY the opening
    // balance, never an arbitrary amount.
    const productId = await makeLedgerOnlyProduct("opening");
    const opening = 7;
    await db
      .insert(productLocationStock)
      .values({ orgId, productId, locationId, stock: opening, stockLimit: 10_000 });

    await receiveStock(productId, 3);

    const [pair] = (await reconcile(orgId)).filter(
      (p) => p.productId === productId && p.locationId === locationId,
    );
    expect(pair.stock).toBe(opening + 3);
    expect(pair.ledger).toBe(3);
    expect(pair.stock - pair.ledger).toBe(opening);
    expect(opening + pair.ledger).toBe(pair.stock);
  });
});

describe.skipIf(!hasDb)("6.6 database-wide reconciliation audit", () => {
  /**
   * Rows created by integrityConcurrency.test.ts are excluded: that file
   * deliberately leaves one divergent pair on disk for the duration of its run
   * (the concurrent-setStock race, which is a reported finding). Vitest runs
   * test files in parallel, so without the carve-out this assertion would
   * inherit another file's intentional breakage instead of measuring the
   * system.
   */
  const isForeignBreakage = (p: Pair) =>
    (p.orgName ?? "").startsWith("Integrity Concurrency");

  it("stock == opening + sum(delta) for every product+location with a ledger", async () => {
    // The generalised invariant. `opening` is previous_stock on the earliest
    // movement, which captures any balance that predates the ledger (seeds,
    // imports, backfills) without excusing arithmetic drift.
    const broken = (await reconcile())
      .filter((p) => p.moves > 0 && !isForeignBreakage(p))
      .filter((p) => (p.opening ?? 0) + p.ledger !== p.stock)
      .map((p) => ({
        product: p.productId,
        location: p.locationId,
        org: p.orgName,
        stock: p.stock,
        opening: p.opening,
        ledger: p.ledger,
        drift: p.stock - ((p.opening ?? 0) + p.ledger),
      }));

    expect(broken).toEqual([]);
  });

  it("the latest movement's new_stock equals the current stock", async () => {
    // Independent of the sum: whoever wrote the ledger last must have written
    // the value the row now holds. A mismatch means something changed stock
    // without going through adjustProductLocationStock.
    const broken = (await reconcile())
      .filter((p) => p.moves > 0 && !isForeignBreakage(p))
      .filter((p) => p.closing !== p.stock)
      .map((p) => ({
        product: p.productId,
        location: p.locationId,
        org: p.orgName,
        stock: p.stock,
        closing: p.closing,
      }));

    expect(broken).toEqual([]);
  });

  it("the ledger is chained: each movement's previous_stock is the prior new_stock", async () => {
    // Scoped to this file's org so the assertion is deterministic; a break here
    // means two writers interleaved without the row being locked.
    const result = await db.execute(sql`
      SELECT m.product_id, m.location_id, m.previous_stock, m.new_stock, m.delta,
             LAG(m.new_stock) OVER (
               PARTITION BY m.product_id, m.location_id
               ORDER BY m.created_at ASC, m.movement_id ASC
             ) AS prior_new
      FROM inventory_movements m
      WHERE m.org_id = ${orgId}
    `);
    const rows = (result as unknown as { rows: Record<string, unknown>[] }).rows;
    expect(rows.length).toBeGreaterThan(0);

    const breaks = rows.filter(
      (r) => r.prior_new != null && Number(r.prior_new) !== Number(r.previous_stock),
    );
    expect(breaks).toEqual([]);

    // And every row's own arithmetic must add up.
    const badArithmetic = rows.filter(
      (r) => Number(r.previous_stock) + Number(r.delta) !== Number(r.new_stock),
    );
    expect(badArithmetic).toEqual([]);
  });

  it("no movement row is orphaned from a stock row", async () => {
    // A movement for a product+location with no stock row would mean the ledger
    // is recording changes to something that does not exist.
    const orphans = await db
      .select({
        productId: inventoryMovements.productId,
        locationId: inventoryMovements.locationId,
        n: sql<number>`count(*)::int`,
      })
      .from(inventoryMovements)
      .leftJoin(
        productLocationStock,
        and(
          eq(productLocationStock.productId, inventoryMovements.productId),
          eq(productLocationStock.locationId, inventoryMovements.locationId),
        ),
      )
      .where(isNull(productLocationStock.id))
      .groupBy(inventoryMovements.productId, inventoryMovements.locationId);

    expect(orphans).toEqual([]);
  });
});
