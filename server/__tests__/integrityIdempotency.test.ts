/**
 * Phase 6.1 — Idempotency of completion / settlement operations.
 *
 * Every operation here is invoked twice against the same row. The second call
 * must be a no-op: either it reports `idempotent`, or it is rejected. What it
 * must never do is apply its side effect a second time.
 *
 * Requires DATABASE_URL (imports ../db at module level), so this file must be
 * listed in the `exclude` array in vitest.config.ts for the no-DB unit run,
 * mirroring orderOutboxAtomicity.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
  inventoryTransferItems,
  giftCards,
  giftCardMovements,
  orders,
  orderItems,
  eventOutbox,
} from "@shared/schema";
import { createPurchaseDraftsBatch, setPurchaseDraftStatus } from "../services/purchaseDrafts";
import {
  createGoodsReceipt,
  completeGoodsReceipt,
  voidGoodsReceipt,
  getPurchaseDraftReceiving,
} from "../services/goodsReceipts";
import { createTransfer, updateTransferStatus } from "../services/inventoryTransfers";
import { redeemGiftCardInTx, issueGiftCardInTx, voidGiftCardInTx } from "../lib/giftCardService";
import { InventoryWorker } from "../workers/inventoryWorker";
import type { EventEnvelope } from "@shared/schema";

const hasDb = !!process.env.DATABASE_URL;

const createdOrgIds: string[] = [];
const createdCorrelationIds: string[] = [];

let orgId: string;
let locationId: string;
let altLocationId: string;
let productId: string;
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
      address: "1 Integrity Way",
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

async function makeProduct(org: string, loc: string, name: string, sku: string) {
  const [p] = await db
    .insert(products)
    .values({ orgId: org, locationId: loc, name, productId: sku, defaultSalePrice: "9.99" })
    .returning();
  return p.id;
}

async function stockAt(product: string, loc: string) {
  const [row] = await db
    .select({ stock: productLocationStock.stock })
    .from(productLocationStock)
    .where(
      and(
        eq(productLocationStock.productId, product),
        eq(productLocationStock.locationId, loc),
      ),
    );
  return row?.stock ?? null;
}

async function movementCount(product: string, loc: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.productId, product),
        eq(inventoryMovements.locationId, loc),
      ),
    );
  return Number(row?.n ?? 0);
}

/** Builds an approved purchase draft with one line, ready to receive. */
async function approvedDraft(qty: number) {
  const [draft] = await createPurchaseDraftsBatch(orgId, [
    { supplierId, locationId, items: [{ productId, quantity: qty }] },
  ]);
  await setPurchaseDraftStatus(orgId, draft!.id, "reviewed");
  await setPurchaseDraftStatus(orgId, draft!.id, "approved");
  return draft!.id;
}

async function makeOrderRow(total: string) {
  const [order] = await db
    .insert(orders)
    .values({ orgId, locationId, total, paymentMethod: "cash", status: "completed" })
    .returning();
  createdCorrelationIds.push(order.id);
  return order.id;
}

beforeAll(async () => {
  if (!hasDb) return;
  orgId = await makeOrg(`Integrity Idempotency ${Date.now()}`);
  locationId = await makeLocation(orgId, "Idem Main", 1);
  altLocationId = await makeLocation(orgId, "Idem Annex");
  productId = await makeProduct(orgId, locationId, "Idem Widget", `IDEM-${Date.now()}`);
  supplierId = (
    await db
      .insert(suppliers)
      .values({ orgId, name: "Idem Supplier", leadTimeDays: 2, isActive: 1 })
      .returning()
  )[0].id;

  await db.insert(productLocationStock).values([
    { orgId, productId, locationId, stock: 100, stockLimit: 500 },
    { orgId, productId, locationId: altLocationId, stock: 0, stockLimit: 500 },
  ]);
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
  await db.delete(giftCards).where(inArray(giftCards.orgId, inOrgs));
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

describe.skipIf(!hasDb)("6.1 completeGoodsReceipt replay", () => {
  it("second completion is a no-op: no extra stock, no extra movement, line unchanged", async () => {
    const draftId = await approvedDraft(6);
    const receiving = await getPurchaseDraftReceiving(orgId, draftId);
    const receipt = await createGoodsReceipt(orgId, {
      purchaseDraftId: draftId,
      items: [
        {
          purchaseDraftItemId: receiving.items[0].id,
          productId,
          quantityReceived: 6,
        },
      ],
    });

    const stockBefore = await stockAt(productId, locationId);
    const movesBefore = await movementCount(productId, locationId);

    const first = await completeGoodsReceipt(orgId, receipt!.id, "idem-test");
    expect(first.idempotent).toBe(false);
    expect(await stockAt(productId, locationId)).toBe(stockBefore! + 6);
    expect(await movementCount(productId, locationId)).toBe(movesBefore + 1);

    const second = await completeGoodsReceipt(orgId, receipt!.id, "idem-test");
    expect(second.idempotent).toBe(true);
    expect(await stockAt(productId, locationId)).toBe(stockBefore! + 6);
    expect(await movementCount(productId, locationId)).toBe(movesBefore + 1);

    const [line] = await db
      .select({ received: purchaseDraftItems.quantityReceived })
      .from(purchaseDraftItems)
      .where(eq(purchaseDraftItems.purchaseDraftId, draftId));
    expect(line.received).toBe(6);

    // A third replay must still be inert.
    const third = await completeGoodsReceipt(orgId, receipt!.id, "idem-test");
    expect(third.idempotent).toBe(true);
    expect(await stockAt(productId, locationId)).toBe(stockBefore! + 6);
  });

  it("voidGoodsReceipt replay returns the voided receipt without further effect", async () => {
    const draftId = await approvedDraft(3);
    const receiving = await getPurchaseDraftReceiving(orgId, draftId);
    const receipt = await createGoodsReceipt(orgId, {
      purchaseDraftId: draftId,
      items: [
        { purchaseDraftItemId: receiving.items[0].id, productId, quantityReceived: 3 },
      ],
    });

    const stockBefore = await stockAt(productId, locationId);
    const first = await voidGoodsReceipt(orgId, receipt!.id);
    expect(first!.status).toBe("voided");
    const second = await voidGoodsReceipt(orgId, receipt!.id);
    expect(second!.status).toBe("voided");
    expect(await stockAt(productId, locationId)).toBe(stockBefore);

    // And a voided receipt can never later be completed.
    await expect(completeGoodsReceipt(orgId, receipt!.id, "idem-test")).rejects.toThrow(
      /voided/i,
    );
    expect(await stockAt(productId, locationId)).toBe(stockBefore);
  });
});

describe.skipIf(!hasDb)("6.1 transfer completion replay", () => {
  it("second completion is rejected and moves no further stock", async () => {
    const transfer = await createTransfer(orgId, {
      fromLocationId: locationId,
      toLocationId: altLocationId,
      items: [{ productId, quantity: 5 }],
    });
    await updateTransferStatus(orgId, transfer!.id, "requested");
    await updateTransferStatus(orgId, transfer!.id, "in_transit");

    const fromBefore = (await stockAt(productId, locationId))!;
    const toBefore = (await stockAt(productId, altLocationId))!;

    await updateTransferStatus(orgId, transfer!.id, "completed");
    expect(await stockAt(productId, locationId)).toBe(fromBefore - 5);
    expect(await stockAt(productId, altLocationId)).toBe(toBefore + 5);

    await expect(updateTransferStatus(orgId, transfer!.id, "completed")).rejects.toThrow(
      /completed and cannot change/i,
    );

    // The invariant that matters: stock did not move twice.
    expect(await stockAt(productId, locationId)).toBe(fromBefore - 5);
    expect(await stockAt(productId, altLocationId)).toBe(toBefore + 5);
  });
});

describe.skipIf(!hasDb)("6.1 gift card redemption replay", () => {
  it("replaying the same order's redemption reports idempotent and leaves balance alone", async () => {
    const orderId = await makeOrderRow("50.00");
    const issued = await db.transaction((tx) =>
      issueGiftCardInTx(tx, {
        orgId,
        amount: 50,
        issuedByUserId: "idem-user",
        actorUserId: "idem-user",
      }),
    );
    createdCorrelationIds.push(issued.card.id);

    const first = await db.transaction((tx) =>
      redeemGiftCardInTx(tx, {
        orgId,
        code: issued.code,
        amount: 20,
        orderId,
        actorUserId: "idem-user",
      }),
    );
    expect(first.idempotent).toBe(false);
    expect(parseFloat(String(first.card!.balance))).toBe(30);

    const second = await db.transaction((tx) =>
      redeemGiftCardInTx(tx, {
        orgId,
        code: issued.code,
        amount: 20,
        orderId,
        actorUserId: "idem-user",
      }),
    );
    expect(second.idempotent).toBe(true);

    const [after] = await db.select().from(giftCards).where(eq(giftCards.id, issued.card.id));
    expect(parseFloat(String(after.balance))).toBe(30);

    const redeems = await db
      .select()
      .from(giftCardMovements)
      .where(
        and(
          eq(giftCardMovements.giftCardId, issued.card.id),
          eq(giftCardMovements.type, "redeem"),
        ),
      );
    expect(redeems).toHaveLength(1);
  });

  it("a second redemption on a different order cannot draw past the balance", async () => {
    const orderA = await makeOrderRow("40.00");
    const orderB = await makeOrderRow("40.00");
    const issued = await db.transaction((tx) =>
      issueGiftCardInTx(tx, {
        orgId,
        amount: 40,
        issuedByUserId: "idem-user",
        actorUserId: "idem-user",
      }),
    );
    createdCorrelationIds.push(issued.card.id);

    await db.transaction((tx) =>
      redeemGiftCardInTx(tx, {
        orgId,
        code: issued.code,
        amount: 40,
        orderId: orderA,
        actorUserId: "idem-user",
      }),
    );

    await expect(
      db.transaction((tx) =>
        redeemGiftCardInTx(tx, {
          orgId,
          code: issued.code,
          amount: 40,
          orderId: orderB,
          actorUserId: "idem-user",
        }),
      ),
    ).rejects.toThrow();

    const [after] = await db.select().from(giftCards).where(eq(giftCards.id, issued.card.id));
    expect(parseFloat(String(after.balance))).toBe(0);
    expect(after.status).toBe("redeemed");
  });

  it("voidGiftCardInTx replay reports idempotent and does not add a second movement", async () => {
    const issued = await db.transaction((tx) =>
      issueGiftCardInTx(tx, {
        orgId,
        amount: 15,
        issuedByUserId: "idem-user",
        actorUserId: "idem-user",
      }),
    );
    createdCorrelationIds.push(issued.card.id);

    const first = await db.transaction((tx) =>
      voidGiftCardInTx(tx, { orgId, code: issued.code, actorUserId: "idem-user" }),
    );
    expect(first.idempotent).toBe(false);
    const second = await db.transaction((tx) =>
      voidGiftCardInTx(tx, { orgId, code: issued.code, actorUserId: "idem-user" }),
    );
    expect(second.idempotent).toBe(true);

    const voids = await db
      .select()
      .from(giftCardMovements)
      .where(
        and(
          eq(giftCardMovements.giftCardId, issued.card.id),
          eq(giftCardMovements.type, "void"),
        ),
      );
    expect(voids).toHaveLength(1);
  });
});

describe.skipIf(!hasDb)("6.1 InventoryWorker event replay", () => {
  it("a re-delivered OrderCreated event deducts stock exactly once", async () => {
    const orderId = await makeOrderRow("19.98");
    await db.insert(orderItems).values({
      orgId,
      orderId,
      productId,
      quantity: 2,
      unitPrice: "9.99",
      totalPrice: "19.98",
    });

    const worker = new InventoryWorker();
    const event = {
      eventId: `idem-order-created-${orderId}`,
      eventType: "OrderCreated",
      occurredAt: new Date().toISOString(),
      correlationId: orderId,
      actor: { type: "system" as const, id: "test" },
      source: "test",
      version: 1,
      payload: {
        orderId,
        orgId,
        items: [{ productId, name: "Idem Widget", qty: 2, unitPrice: 9.99 }],
      },
    } as unknown as EventEnvelope;

    const before = (await stockAt(productId, locationId))!;
    const first = await worker.handle(event);
    expect(first.status).toBe("success");
    expect(await stockAt(productId, locationId)).toBe(before - 2);

    const second = await worker.handle(event);
    expect(second.status).toBe("success");
    expect(second.summary).toMatch(/idempotent/i);
    expect(await stockAt(productId, locationId)).toBe(before - 2);

    const moves = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.eventId, event.eventId));
    expect(moves).toHaveLength(1);
  });

  it("a re-delivered RefundIssued event returns stock exactly once", async () => {
    const orderId = await makeOrderRow("9.99");
    const worker = new InventoryWorker();
    const event = {
      eventId: `idem-refund-${orderId}`,
      eventType: "RefundIssued",
      occurredAt: new Date().toISOString(),
      correlationId: orderId,
      actor: { type: "system" as const, id: "test" },
      source: "test",
      version: 1,
      payload: {
        orderId,
        orgId,
        lines: [{ lineId: "l1", qty: 1, productId }],
      },
    } as unknown as EventEnvelope;

    const before = (await stockAt(productId, locationId))!;
    await worker.handle(event);
    expect(await stockAt(productId, locationId)).toBe(before + 1);
    const second = await worker.handle(event);
    expect(second.summary).toMatch(/idempotent/i);
    expect(await stockAt(productId, locationId)).toBe(before + 1);
  });
});

describe.skipIf(!hasDb)("6.1 purchase draft status replay", () => {
  it("re-approving an approved draft leaves it approved and does not duplicate state", async () => {
    const draftId = await approvedDraft(4);
    const [first] = await db
      .select({ status: purchaseDrafts.status })
      .from(purchaseDrafts)
      .where(eq(purchaseDrafts.id, draftId));
    expect(first.status).toBe("approved");

    // Whatever the service decides — accept or reject — the row must still be
    // exactly "approved" afterwards and the item lines untouched.
    const itemsBefore = await db
      .select()
      .from(purchaseDraftItems)
      .where(eq(purchaseDraftItems.purchaseDraftId, draftId));

    await setPurchaseDraftStatus(orgId, draftId, "approved").catch(() => undefined);

    const [after] = await db
      .select({ status: purchaseDrafts.status })
      .from(purchaseDrafts)
      .where(eq(purchaseDrafts.id, draftId));
    expect(after.status).toBe("approved");
    const itemsAfter = await db
      .select()
      .from(purchaseDraftItems)
      .where(eq(purchaseDraftItems.purchaseDraftId, draftId));
    expect(itemsAfter).toHaveLength(itemsBefore.length);
  });
});

describe.skipIf(!hasDb)("6.1 goods receipt line integrity after replay", () => {
  it("receipt line rows are never duplicated by replayed completion", async () => {
    const draftId = await approvedDraft(2);
    const receiving = await getPurchaseDraftReceiving(orgId, draftId);
    const receipt = await createGoodsReceipt(orgId, {
      purchaseDraftId: draftId,
      items: [
        { purchaseDraftItemId: receiving.items[0].id, productId, quantityReceived: 2 },
      ],
    });
    await completeGoodsReceipt(orgId, receipt!.id, "idem-test");
    await completeGoodsReceipt(orgId, receipt!.id, "idem-test");

    const lines = await db
      .select()
      .from(goodsReceiptItems)
      .where(eq(goodsReceiptItems.goodsReceiptId, receipt!.id));
    expect(lines).toHaveLength(1);
  });
});
