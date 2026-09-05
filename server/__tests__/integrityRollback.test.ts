/**
 * Phase 6.2 — Rollback. A failure part-way through a multi-step write must
 * leave nothing behind.
 *
 * Each test drives a real service (or a real Express route) to a failure that
 * happens AFTER at least one write has already been issued inside the
 * transaction, then asserts every table involved is byte-for-byte as it was.
 *
 * Requires DATABASE_URL (imports ../db at module level) → must be added to the
 * `exclude` list in vitest.config.ts for the no-DB run.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { RequestHandler } from "express";
import request from "supertest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  organizations,
  locations,
  products,
  suppliers,
  productLocationStock,
  purchaseDrafts,
  purchaseDraftItems,
  goodsReceipts,
  goodsReceiptItems,
  inventoryMovements,
  inventoryTransfers,
  giftCards,
  giftCardMovements,
  orders,
  orderItems,
  refunds,
  refundLines,
  shifts,
  adminAuditLogs,
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
import { issueGiftCardInTx, redeemGiftCardInTx } from "../lib/giftCardService";
import { registerRefundRoutes } from "../routes/refunds";

const hasDb = !!process.env.DATABASE_URL;

const createdOrgIds: string[] = [];
const createdCorrelationIds: string[] = [];

let orgId: string;
let locationId: string;
let altLocationId: string;
let supplierId: string;

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
      address: "1 Rollback Row",
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

async function makeProduct(name: string, stock: number) {
  const [p] = await db
    .insert(products)
    .values({
      orgId,
      locationId,
      name,
      productId: `RB-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      defaultSalePrice: "10.00",
    })
    .returning();
  await db.insert(productLocationStock).values([
    { orgId, productId: p.id, locationId, stock, stockLimit: 10_000 },
    { orgId, productId: p.id, locationId: altLocationId, stock: 0, stockLimit: 10_000 },
  ]);
  return p.id;
}

async function stockAt(productId: string, loc: string) {
  const [row] = await db
    .select({ stock: productLocationStock.stock })
    .from(productLocationStock)
    .where(
      and(
        eq(productLocationStock.productId, productId),
        eq(productLocationStock.locationId, loc),
      ),
    );
  return row?.stock ?? null;
}

async function movementCount(productId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(inventoryMovements)
    .where(eq(inventoryMovements.productId, productId));
  return Number(row?.n ?? 0);
}

async function makeOrderRow(total: string, customerId: string | null = null) {
  const [order] = await db
    .insert(orders)
    .values({
      orgId,
      locationId,
      customerId,
      total,
      settledTotal: total,
      settledAt: new Date(),
      paymentMethod: "cash",
      status: "completed",
    })
    .returning();
  createdCorrelationIds.push(order.id);
  return order.id;
}

beforeAll(async () => {
  if (!hasDb) return;
  orgId = await makeOrg(`Integrity Rollback ${Date.now()}`);
  locationId = await makeLocation(orgId, "Rollback Main", 1);
  altLocationId = await makeLocation(orgId, "Rollback Annex");
  supplierId = (
    await db
      .insert(suppliers)
      .values({ orgId, name: "Rollback Supplier", leadTimeDays: 1, isActive: 1 })
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
  await db.delete(adminAuditLogs).where(inArray(adminAuditLogs.orgId, inOrgs));
  await db.delete(inventoryMovements).where(inArray(inventoryMovements.orgId, inOrgs));
  await db.delete(giftCards).where(inArray(giftCards.orgId, inOrgs));
  await db.delete(refunds).where(inArray(refunds.orgId, inOrgs));
  await db.delete(orderItems).where(inArray(orderItems.orgId, inOrgs));
  await db.delete(orders).where(inArray(orders.orgId, inOrgs));
  await db.delete(shifts).where(inArray(shifts.orgId, inOrgs));
  await db.delete(inventoryTransfers).where(inArray(inventoryTransfers.orgId, inOrgs));
  await db.delete(goodsReceipts).where(inArray(goodsReceipts.orgId, inOrgs));
  await db.delete(purchaseDrafts).where(inArray(purchaseDrafts.orgId, inOrgs));
  await db.delete(productLocationStock).where(inArray(productLocationStock.orgId, inOrgs));
  await db.delete(products).where(inArray(products.orgId, inOrgs));
  await db.delete(suppliers).where(inArray(suppliers.orgId, inOrgs));
  await db.delete(locations).where(inArray(locations.orgId, inOrgs));
  await db.delete(organizations).where(inArray(organizations.id, inOrgs));
});

describe.skipIf(!hasDb)("6.2 stock adjustment rollback", () => {
  it("rolls back stock row AND movement row when the caller's transaction aborts", async () => {
    const productId = await makeProduct("abort", 40);

    await expect(
      db.transaction(async (tx) => {
        await adjustProductLocationStock(
          {
            orgId,
            productId,
            locationId,
            delta: -10,
            movement: {
              reason: "adjustment",
              correlationId: `rb-${productId}`,
              eventId: `rb-${productId}-1`,
              sku: "RB",
            },
          },
          tx,
        );
        // Proof the write really happened before the abort.
        const [mid] = await tx
          .select({ stock: productLocationStock.stock })
          .from(productLocationStock)
          .where(
            and(
              eq(productLocationStock.productId, productId),
              eq(productLocationStock.locationId, locationId),
            ),
          );
        expect(mid.stock).toBe(30);
        throw new Error("force rollback");
      }),
    ).rejects.toThrow("force rollback");

    expect(await stockAt(productId, locationId)).toBe(40);
    expect(await movementCount(productId)).toBe(0);
  });

  it("rolls back every step of a multi-product adjustment, not just the last", async () => {
    const a = await makeProduct("multiA", 20);
    const b = await makeProduct("multiB", 20);

    await expect(
      db.transaction(async (tx) => {
        for (const [i, p] of [a, b].entries()) {
          await adjustProductLocationStock(
            {
              orgId,
              productId: p,
              locationId,
              delta: -5,
              movement: {
                reason: "adjustment",
                correlationId: `rb-multi-${a}`,
                eventId: `rb-multi-${a}-${i}`,
                sku: "RB",
              },
            },
            tx,
          );
        }
        throw new Error("force rollback after both writes");
      }),
    ).rejects.toThrow(/force rollback/);

    expect(await stockAt(a, locationId)).toBe(20);
    expect(await stockAt(b, locationId)).toBe(20);
    expect(await movementCount(a)).toBe(0);
    expect(await movementCount(b)).toBe(0);
  });

  it("does not leave an auto-created product_location_stock row behind on abort", async () => {
    // adjustProductLocationStock inserts the stock row if it is missing. That
    // insert must roll back with everything else.
    const [p] = await db
      .insert(products)
      .values({
        orgId,
        locationId,
        name: "rb-autorow",
        productId: `RB-AUTO-${Date.now()}`,
        defaultSalePrice: "1.00",
      })
      .returning();

    await expect(
      db.transaction(async (tx) => {
        await adjustProductLocationStock(
          {
            orgId,
            productId: p.id,
            locationId: altLocationId,
            delta: 5,
            movement: {
              reason: "adjustment",
              correlationId: `rb-auto-${p.id}`,
              eventId: `rb-auto-${p.id}`,
              sku: "RB",
            },
          },
          tx,
        );
        throw new Error("force rollback");
      }),
    ).rejects.toThrow("force rollback");

    const rows = await db
      .select()
      .from(productLocationStock)
      .where(eq(productLocationStock.productId, p.id));
    expect(rows).toHaveLength(0);
    expect(await movementCount(p.id)).toBe(0);
  });
});

describe.skipIf(!hasDb)("6.2 transfer completion rollback", () => {
  it("a mid-loop insufficient-stock failure leaves no stock moved and no movements", async () => {
    // Genuine partial-failure: the first line succeeds (both legs), the second
    // line has no stock at source and raises INSUFFICIENT_STOCK inside the same
    // transaction. Nothing at all may survive.
    const good = await makeProduct("txfrGood", 30);
    const empty = await makeProduct("txfrEmpty", 0);

    const transfer = await createTransfer(orgId, {
      fromLocationId: locationId,
      toLocationId: altLocationId,
      items: [
        { productId: good, quantity: 5 },
        { productId: empty, quantity: 5 },
      ],
    });
    await updateTransferStatus(orgId, transfer!.id, "requested");
    await updateTransferStatus(orgId, transfer!.id, "in_transit");

    await expect(updateTransferStatus(orgId, transfer!.id, "completed")).rejects.toThrow();

    // Order-independent invariant: no stock moved anywhere, no ledger rows, and
    // the transfer is still in_transit (not half-completed).
    expect(await stockAt(good, locationId)).toBe(30);
    expect(await stockAt(good, altLocationId)).toBe(0);
    expect(await stockAt(empty, locationId)).toBe(0);
    expect(await stockAt(empty, altLocationId)).toBe(0);
    expect(await movementCount(good)).toBe(0);
    expect(await movementCount(empty)).toBe(0);

    const [row] = await db
      .select({ status: inventoryTransfers.status, completedAt: inventoryTransfers.completedAt })
      .from(inventoryTransfers)
      .where(eq(inventoryTransfers.id, transfer!.id));
    expect(row.status).toBe("in_transit");
    expect(row.completedAt).toBeNull();
  });
});

describe.skipIf(!hasDb)("6.2 goods receipt completion rollback", () => {
  it("an over-receive raised inside the completion transaction leaves nothing applied", async () => {
    const productA = await makeProduct("grA", 0);
    const productB = await makeProduct("grB", 0);

    const [draft] = await createPurchaseDraftsBatch(orgId, [
      {
        supplierId,
        locationId,
        items: [
          { productId: productA, quantity: 5 },
          { productId: productB, quantity: 5 },
        ],
      },
    ]);
    await setPurchaseDraftStatus(orgId, draft!.id, "reviewed");
    await setPurchaseDraftStatus(orgId, draft!.id, "approved");

    const receiving = await getPurchaseDraftReceiving(orgId, draft!.id);
    const lineA = receiving.items.find((i) => i.productId === productA)!;
    const lineB = receiving.items.find((i) => i.productId === productB)!;

    const receipt = await createGoodsReceipt(orgId, {
      purchaseDraftId: draft!.id,
      items: [
        { purchaseDraftItemId: lineA.id, productId: productA, quantityReceived: 5 },
        { purchaseDraftItemId: lineB.id, productId: productB, quantityReceived: 5 },
      ],
    });

    // Someone else consumes line B's remaining quantity after this receipt was
    // raised, so completion must fail — and must not half-apply line A.
    await db
      .update(purchaseDraftItems)
      .set({ quantityReceived: 5 })
      .where(eq(purchaseDraftItems.id, lineB.id));

    await expect(completeGoodsReceipt(orgId, receipt!.id, "rb")).rejects.toThrow();

    expect(await stockAt(productA, locationId)).toBe(0);
    expect(await stockAt(productB, locationId)).toBe(0);
    expect(await movementCount(productA)).toBe(0);
    expect(await movementCount(productB)).toBe(0);

    const [receiptRow] = await db
      .select({ status: goodsReceipts.status, receivedAt: goodsReceipts.receivedAt })
      .from(goodsReceipts)
      .where(eq(goodsReceipts.id, receipt!.id));
    expect(receiptRow.status).toBe("pending");
    expect(receiptRow.receivedAt).toBeNull();

    const [draftRow] = await db
      .select({ status: purchaseDrafts.status })
      .from(purchaseDrafts)
      .where(eq(purchaseDrafts.id, draft!.id));
    expect(draftRow.status).toBe("approved");

    const [lineARow] = await db
      .select({ received: purchaseDraftItems.quantityReceived })
      .from(purchaseDraftItems)
      .where(eq(purchaseDraftItems.id, lineA.id));
    expect(lineARow.received).toBe(0);

    const lines = await db
      .select()
      .from(goodsReceiptItems)
      .where(eq(goodsReceiptItems.goodsReceiptId, receipt!.id));
    expect(lines).toHaveLength(2);
  });
});

describe.skipIf(!hasDb)("6.2 purchase draft batch rollback", () => {
  it("an invalid later group rolls back the drafts AND the item lines of earlier groups", async () => {
    const productId = await makeProduct("batch", 0);
    const draftsBefore = await db
      .select({ id: purchaseDrafts.id })
      .from(purchaseDrafts)
      .where(eq(purchaseDrafts.orgId, orgId));
    const itemsBefore = await db
      .select({ id: purchaseDraftItems.id })
      .from(purchaseDraftItems)
      .where(eq(purchaseDraftItems.orgId, orgId));

    await expect(
      createPurchaseDraftsBatch(orgId, [
        { supplierId, locationId, items: [{ productId, quantity: 4 }] },
        { supplierId, locationId, items: [{ productId, quantity: 0 }] },
      ]),
    ).rejects.toThrow();

    const draftsAfter = await db
      .select({ id: purchaseDrafts.id })
      .from(purchaseDrafts)
      .where(eq(purchaseDrafts.orgId, orgId));
    const itemsAfter = await db
      .select({ id: purchaseDraftItems.id })
      .from(purchaseDraftItems)
      .where(eq(purchaseDraftItems.orgId, orgId));

    expect(draftsAfter).toHaveLength(draftsBefore.length);
    expect(itemsAfter).toHaveLength(itemsBefore.length);
  });
});

describe.skipIf(!hasDb)("6.2 gift card rollback", () => {
  it("an aborted issue leaves no card, no movement and no outbox row", async () => {
    const before = await db.select().from(giftCards).where(eq(giftCards.orgId, orgId));

    let cardId = "";
    await expect(
      db.transaction(async (tx) => {
        const issued = await issueGiftCardInTx(tx, {
          orgId,
          amount: 25,
          issuedByUserId: "rb-user",
          actorUserId: "rb-user",
        });
        cardId = issued.card.id;
        throw new Error("force rollback");
      }),
    ).rejects.toThrow("force rollback");

    const after = await db.select().from(giftCards).where(eq(giftCards.orgId, orgId));
    expect(after).toHaveLength(before.length);
    expect(
      await db.select().from(giftCardMovements).where(eq(giftCardMovements.giftCardId, cardId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(eventOutbox).where(eq(eventOutbox.correlationId, cardId)),
    ).toHaveLength(0);
  });

  it("an aborted redemption leaves the balance and the movement log untouched", async () => {
    const orderId = await makeOrderRow("25.00");
    const issued = await db.transaction((tx) =>
      issueGiftCardInTx(tx, {
        orgId,
        amount: 25,
        issuedByUserId: "rb-user",
        actorUserId: "rb-user",
      }),
    );
    createdCorrelationIds.push(issued.card.id);

    await expect(
      db.transaction(async (tx) => {
        await redeemGiftCardInTx(tx, {
          orgId,
          code: issued.code,
          amount: 25,
          orderId,
          actorUserId: "rb-user",
        });
        throw new Error("force rollback");
      }),
    ).rejects.toThrow("force rollback");

    const [card] = await db.select().from(giftCards).where(eq(giftCards.id, issued.card.id));
    expect(parseFloat(String(card.balance))).toBe(25);
    expect(card.status).toBe("active");
    const redeems = await db
      .select()
      .from(giftCardMovements)
      .where(
        and(
          eq(giftCardMovements.giftCardId, issued.card.id),
          eq(giftCardMovements.type, "redeem"),
        ),
      );
    expect(redeems).toHaveLength(0);
  });
});

describe.skipIf(!hasDb)("6.2 refund route rollback", () => {
  const cashierUserId = "rb-cashier";

  it("a store-credit refund with no customer rolls back the refund and its lines", async () => {
    // The failure fires inside the route's db.transaction, AFTER the refund row
    // and every refund_line have been inserted (server/routes/refunds.ts:257).
    await db
      .insert(shifts)
      .values({ orgId, locationId, userId: cashierUserId, status: "open", openingFloat: "0" })
      .onConflictDoNothing();

    const productId = await makeProduct("rbRefund", 50);
    const orderId = await makeOrderRow("20.00", null);
    const [line] = await db
      .insert(orderItems)
      .values({
        orgId,
        orderId,
        productId,
        quantity: 2,
        unitPrice: "10.00",
        totalPrice: "20.00",
      })
      .returning();

    const app = express();
    app.use(express.json());
    const scoped: RequestHandler[] = [
      (req, _res, next) => {
        (req as unknown as { user: unknown }).user = {
          id: cashierUserId,
          role: "ADMIN",
          orgId,
        };
        (req as unknown as { orgContext: unknown }).orgContext = {
          orgId,
          role: "ADMIN",
          locationId,
        };
        next();
      },
    ];
    registerRefundRoutes(app, scoped);

    const cardsBefore = await db
      .select({ id: giftCards.id })
      .from(giftCards)
      .where(eq(giftCards.orgId, orgId));
    // Scoped to this order's correlationId, not a count of the whole table.
    // A global count silently asserts that no OTHER test wrote an envelope
    // while this one ran, which is not what this test is about and is not true
    // once test files run in parallel against a shared database.
    const [outboxBefore] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(eventOutbox)
      .where(eq(eventOutbox.correlationId, orderId));

    const res = await request(app)
      .post(`/api/orders/${orderId}/refunds`)
      .send({
        reason: "damaged",
        refundMethod: "store_credit",
        lines: [{ orderLineId: line.id, qty: 2 }],
      });

    expect(res.status).toBe(400);

    const refundRows = await db
      .select({ id: refunds.id })
      .from(refunds)
      .where(eq(refunds.orderId, orderId));
    expect(refundRows).toHaveLength(0);

    const lineRows = await db
      .select({ id: refundLines.id })
      .from(refundLines)
      .where(eq(refundLines.orderLineId, line.id));
    expect(lineRows).toHaveLength(0);

    // No store credit was minted for a failed refund.
    const cardsAfter = await db
      .select({ id: giftCards.id })
      .from(giftCards)
      .where(eq(giftCards.orgId, orgId));
    expect(cardsAfter).toHaveLength(cardsBefore.length);

    // And no RefundIssued envelope escaped into the outbox.
    const [outboxAfter] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(eventOutbox)
      .where(eq(eventOutbox.correlationId, orderId));
    expect(Number(outboxAfter.n)).toBe(Number(outboxBefore.n));
  });
});
