/**
 * Phase 6.3 — Concurrency. Genuinely parallel operations against the same row.
 *
 * Every race here is executed with real overlapping transactions, not merely
 * sequential calls dressed up as `Promise.all`. Two guards keep these tests
 * from passing vacuously:
 *
 *   1. `describe("harness")` proves that `Promise.all` over `db.transaction`
 *      really does hold several transactions open at once (overlapping
 *      clock_timestamp intervals), and that an unguarded read-modify-write
 *      under that harness loses an update — i.e. the harness can see a race.
 *   2. Where the operation under test accepts a caller-supplied transaction,
 *      `gateUpdates` suspends its first UPDATE until every participant has
 *      finished reading. That makes the interleave deterministic rather than
 *      timing-dependent, so a red result is a real defect and a green result
 *      is real protection.
 *
 * Requires DATABASE_URL (imports ../db at module level) → must be added to the
 * `exclude` list in vitest.config.ts for the no-DB run.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { RequestHandler } from "express";
import request from "supertest";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { db, pool } from "../db";
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
import { InventoryWorker } from "../workers/inventoryWorker";
import { registerRefundRoutes } from "../routes/refunds";
import type { EventEnvelope } from "@shared/schema";

const hasDb = !!process.env.DATABASE_URL;

const createdOrgIds: string[] = [];
const createdCorrelationIds: string[] = [];

let orgId: string;
let locationId: string;
let altLocationId: string;
let supplierId: string;

/** Releases all waiters once `n` participants have arrived. */
function makeBarrier(n: number) {
  let arrived = 0;
  let release!: () => void;
  const open = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    async wait() {
      arrived += 1;
      if (arrived >= n) release();
      await open;
    },
    get opened() {
      return arrived >= n;
    },
  };
}

/**
 * Wraps a drizzle transaction so that the first UPDATE it issues blocks until
 * `gate` resolves. Reads are untouched, so every racer completes its read phase
 * before any writer proceeds — the interleave a lost-update bug needs, made
 * deterministic. The service code under test is not modified in any way.
 */
function gateUpdates<T extends object>(tx: T, gate: Promise<void>): T {
  const wrapChain = (obj: any): any =>
    new Proxy(obj, {
      get(target, prop) {
        if (prop === "then" && typeof target.then === "function") {
          return (onOk: unknown, onErr: unknown) =>
            gate.then(() => target.then(onOk, onErr));
        }
        const value = target[prop];
        if (typeof value === "function") {
          return (...args: unknown[]) => {
            const out = value.apply(target, args);
            return out && typeof out === "object" ? wrapChain(out) : out;
          };
        }
        return value;
      },
    });

  return new Proxy(tx, {
    get(target, prop) {
      const value = (target as Record<string | symbol, unknown>)[prop];
      if (prop === "update" && typeof value === "function") {
        return (...args: unknown[]) => wrapChain((value as Function).apply(target, args));
      }
      return typeof value === "function" ? (value as Function).bind(target) : value;
    },
  }) as T;
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
      address: "1 Race Road",
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

/** Each race gets its own product so parallel test files cannot interfere. */
async function makeProduct(name: string, stock: number, loc = locationId) {
  const [p] = await db
    .insert(products)
    .values({
      orgId,
      locationId: loc,
      name,
      productId: `RACE-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      defaultSalePrice: "10.00",
    })
    .returning();
  await db
    .insert(productLocationStock)
    .values({ orgId, productId: p.id, locationId: loc, stock, stockLimit: 10_000 });
  if (loc !== altLocationId) {
    await db
      .insert(productLocationStock)
      .values({ orgId, productId: p.id, locationId: altLocationId, stock: 0, stockLimit: 10_000 });
  }
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

async function movementSum(productId: string, loc: string) {
  const [row] = await db
    .select({ total: sql<number>`COALESCE(SUM(${inventoryMovements.delta}), 0)::int` })
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.productId, productId),
        eq(inventoryMovements.locationId, loc),
      ),
    );
  return Number(row?.total ?? 0);
}

async function movementCount(productId: string, loc: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.productId, productId),
        eq(inventoryMovements.locationId, loc),
      ),
    );
  return Number(row?.n ?? 0);
}

async function makeOrderRow(total: string) {
  const [order] = await db
    .insert(orders)
    .values({
      orgId,
      locationId,
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
  orgId = await makeOrg(`Integrity Concurrency ${Date.now()}`);
  locationId = await makeLocation(orgId, "Race Main", 1);
  altLocationId = await makeLocation(orgId, "Race Annex");
  supplierId = (
    await db
      .insert(suppliers)
      .values({ orgId, name: "Race Supplier", leadTimeDays: 1, isActive: 1 })
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

// ---------------------------------------------------------------------------
// Harness credibility: the parallel runner must genuinely overlap, and must be
// able to observe a race. Without these two tests every result below could be
// a sequential run wearing a Promise.all costume.
// ---------------------------------------------------------------------------
describe.skipIf(!hasDb)("6.3 harness — parallelism is real", () => {
  it("holds four transactions open simultaneously", async () => {
    const barrier = makeBarrier(4);
    const spans = await Promise.all(
      Array.from({ length: 4 }, () =>
        db.transaction(async (tx) => {
          const started = await tx.execute(sql`select clock_timestamp() as t`);
          await barrier.wait();
          const ended = await tx.execute(sql`select clock_timestamp() as t`);
          const read = (r: unknown) =>
            new Date(
              String((r as { rows: { t: string }[] }).rows[0].t),
            ).getTime();
          return { start: read(started), end: read(ended) };
        }),
      ),
    );

    // All four barrier arrivals happened, so all four transactions were open
    // at the same instant. Interval arithmetic confirms it independently.
    expect(barrier.opened).toBe(true);
    const latestStart = Math.max(...spans.map((s) => s.start));
    const earliestEnd = Math.min(...spans.map((s) => s.end));
    expect(latestStart).toBeLessThanOrEqual(earliestEnd);
  });

  it("detects a lost update in an unguarded read-modify-write (control)", async () => {
    // Deliberately racy SQL on a row this test owns: read the value, then write
    // back read+1 from application memory. Two overlapping transactions doing
    // this must lose one increment. If this test ever reports 2, the harness is
    // not actually overlapping and every race result below is worthless.
    const productId = await makeProduct("control", 0);
    const [row] = await db
      .select({ id: productLocationStock.id })
      .from(productLocationStock)
      .where(
        and(
          eq(productLocationStock.productId, productId),
          eq(productLocationStock.locationId, locationId),
        ),
      );

    const barrier = makeBarrier(2);
    const racer = async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const read = await client.query(
          "SELECT stock FROM product_location_stock WHERE id = $1",
          [row.id],
        );
        const seen = Number(read.rows[0].stock);
        await barrier.wait();
        await client.query("UPDATE product_location_stock SET stock = $1 WHERE id = $2", [
          seen + 1,
          row.id,
        ]);
        await client.query("COMMIT");
      } finally {
        client.release();
      }
    };

    await Promise.all([racer(), racer()]);
    expect(await stockAt(productId, locationId)).toBe(1); // 2 increments, 1 survives
  });
});

// ---------------------------------------------------------------------------
// 6.3 (a) Parallel stock movements on the same product+location.
// ---------------------------------------------------------------------------
describe.skipIf(!hasDb)("6.3 parallel stock movements on one product+location", () => {
  it("applies every concurrent delta exactly once", async () => {
    const productId = await makeProduct("delta", 100);
    const parallel = 8;

    await Promise.all(
      Array.from({ length: parallel }, (_, i) =>
        adjustProductLocationStock({
          orgId,
          productId,
          locationId,
          delta: -3,
          allowNegative: false,
          movement: {
            reason: "adjustment",
            correlationId: `race-delta-${productId}`,
            eventId: `race-delta-${productId}-${i}`,
            sku: "RACE",
          },
        }),
      ),
    );

    expect(await stockAt(productId, locationId)).toBe(100 - 3 * parallel);
    expect(await movementCount(productId, locationId)).toBe(parallel);
    expect(await movementSum(productId, locationId)).toBe(-3 * parallel);
  });

  it("never lets concurrent decrements drive stock negative", async () => {
    // Only one unit available; four racers each want one.
    const productId = await makeProduct("oversell", 1);
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, (_, i) =>
        adjustProductLocationStock({
          orgId,
          productId,
          locationId,
          delta: -1,
          allowNegative: false,
          movement: {
            reason: "sale",
            correlationId: `race-oversell-${productId}`,
            eventId: `race-oversell-${productId}-${i}`,
            sku: "RACE",
          },
        }),
      ),
    );

    const ok = results.filter((r) => r.status === "fulfilled").length;
    expect(ok).toBe(1);
    expect(await stockAt(productId, locationId)).toBe(0);
    expect(await movementCount(productId, locationId)).toBe(1);
  });

  it("keeps the movement ledger consistent with the row for concurrent setStock writes", async () => {
    // FINDING CANDIDATE: the `setStock` branch of adjustProductLocationStock
    // reads `previousStock` in one statement and writes an absolute value in
    // the next, with no row lock. Under overlap the recorded delta
    // (newStock - staleprevious) no longer telescopes, so
    // sum(movements.delta) drifts away from the row.
    const productId = await makeProduct("setstock", 10);
    const barrier = makeBarrier(2);

    const setter = (value: number, i: number) =>
      db.transaction(async (tx) => {
        await barrier.wait();
        return adjustProductLocationStock(
          {
            orgId,
            productId,
            locationId,
            setStock: value,
            movement: {
              reason: "adjustment",
              correlationId: `race-set-${productId}`,
              eventId: `race-set-${productId}-${i}`,
              sku: "RACE",
            },
          },
          gateUpdates(tx, barrier.wait()),
        );
      });

    await Promise.allSettled([setter(20, 0), setter(5, 1)]);

    const finalStock = (await stockAt(productId, locationId))!;
    const ledger = await movementSum(productId, locationId);
    // Opening balance 10 was set directly, so the ledger must account for the
    // change from 10 to finalStock.
    expect(10 + ledger).toBe(finalStock);
  });
});

// ---------------------------------------------------------------------------
// 6.3 (b) Two simultaneous completions of the same goods receipt.
// ---------------------------------------------------------------------------
describe.skipIf(!hasDb)("6.3 simultaneous goods receipt completions", () => {
  it("applies stock exactly once when four completions race", async () => {
    const productId = await makeProduct("receipt", 0);
    const [draft] = await createPurchaseDraftsBatch(orgId, [
      { supplierId, locationId, items: [{ productId, quantity: 7 }] },
    ]);
    await setPurchaseDraftStatus(orgId, draft!.id, "reviewed");
    await setPurchaseDraftStatus(orgId, draft!.id, "approved");
    const receiving = await getPurchaseDraftReceiving(orgId, draft!.id);
    const receipt = await createGoodsReceipt(orgId, {
      purchaseDraftId: draft!.id,
      items: [
        { purchaseDraftItemId: receiving.items[0].id, productId, quantityReceived: 7 },
      ],
    });

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => completeGoodsReceipt(orgId, receipt!.id, "race")),
    );

    const applied = results.filter(
      (r) => r.status === "fulfilled" && r.value.idempotent === false,
    ).length;
    expect(applied).toBe(1);
    expect(await stockAt(productId, locationId)).toBe(7);
    expect(await movementCount(productId, locationId)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 6.3 (c) Two simultaneous completions of the same inventory transfer.
// ---------------------------------------------------------------------------
describe.skipIf(!hasDb)("6.3 simultaneous inventory transfer completions", () => {
  it("moves stock exactly once when two completions race", async () => {
    // FINDING CANDIDATE: completeTransfer re-reads the transfer inside its
    // transaction but WITHOUT `.for("update")`, so both racers can observe
    // status='in_transit' and both apply the stock movements. The final status
    // UPDATE is guarded on status='in_transit', so the loser silently updates
    // zero rows and still commits its stock changes.
    const productId = await makeProduct("transfer", 50);
    const transfer = await createTransfer(orgId, {
      fromLocationId: locationId,
      toLocationId: altLocationId,
      items: [{ productId, quantity: 10 }],
    });
    await updateTransferStatus(orgId, transfer!.id, "requested");
    await updateTransferStatus(orgId, transfer!.id, "in_transit");

    await Promise.allSettled([
      updateTransferStatus(orgId, transfer!.id, "completed"),
      updateTransferStatus(orgId, transfer!.id, "completed"),
    ]);

    // One object so a failure reports the whole picture at once: how much left
    // the source, how much arrived, and how many ledger rows were written.
    const observed = {
      source: await stockAt(productId, locationId),
      destination: await stockAt(productId, altLocationId),
      sourceMovements: await movementCount(productId, locationId),
      destinationMovements: await movementCount(productId, altLocationId),
    };
    expect(observed).toEqual({
      source: 40,
      destination: 10,
      sourceMovements: 1,
      destinationMovements: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// 6.3 (d) Two simultaneous gift-card redemptions — exactly one should win.
// ---------------------------------------------------------------------------
describe.skipIf(!hasDb)("6.3 simultaneous gift card redemptions", () => {
  it("cannot redeem the same balance twice", async () => {
    // FINDING CANDIDATE: redeemGiftCardInTx reads the card without
    // `.for("update")` and writes an absolute balance, so two overlapping
    // redemptions on different orderIds (the idempotency key is orderId) can
    // both see the full balance and both succeed.
    const orderA = await makeOrderRow("50.00");
    const orderB = await makeOrderRow("50.00");
    const issued = await db.transaction((tx) =>
      issueGiftCardInTx(tx, {
        orgId,
        amount: 50,
        issuedByUserId: "race-user",
        actorUserId: "race-user",
      }),
    );
    createdCorrelationIds.push(issued.card.id);

    const barrier = makeBarrier(2);
    const redeem = (orderId: string) =>
      db.transaction(async (tx) => {
        await barrier.wait();
        return redeemGiftCardInTx(gateUpdates(tx, barrier.wait()), {
          orgId,
          code: issued.code,
          amount: 50,
          orderId,
          actorUserId: "race-user",
        });
      });

    const results = await Promise.allSettled([redeem(orderA), redeem(orderB)]);
    const won = results.filter((r) => r.status === "fulfilled").length;

    const [card] = await db.select().from(giftCards).where(eq(giftCards.id, issued.card.id));
    const redeemRows = await db
      .select({ amount: giftCardMovements.amount })
      .from(giftCardMovements)
      .where(
        and(
          eq(giftCardMovements.giftCardId, issued.card.id),
          eq(giftCardMovements.type, "redeem"),
        ),
      );
    const redeemedTotal = redeemRows.reduce((s, r) => s + parseFloat(String(r.amount)), 0);

    expect(parseFloat(String(card.balance))).toBeGreaterThanOrEqual(0);
    // A £50 card must never fund more than £50 of redemptions.
    expect(redeemedTotal).toBeLessThanOrEqual(50);
    expect(won).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 6.3 (e) Duplicate event delivery to InventoryWorker in parallel.
// ---------------------------------------------------------------------------
describe.skipIf(!hasDb)("6.3 duplicate event delivery to InventoryWorker", () => {
  it("deducts stock once when the same eventId is delivered twice at once", async () => {
    // FINDING CANDIDATE: the idempotency guard is a plain SELECT on
    // inventory_movements.eventId with no unique constraint behind it, so two
    // concurrent deliveries of one event can both pass the check.
    const productId = await makeProduct("dupevent", 20);
    const orderId = await makeOrderRow("30.00");
    await db.insert(orderItems).values({
      orgId,
      orderId,
      productId,
      quantity: 3,
      unitPrice: "10.00",
      totalPrice: "30.00",
    });

    const worker = new InventoryWorker();
    const event = {
      eventId: `race-order-created-${orderId}`,
      eventType: "OrderCreated",
      occurredAt: new Date().toISOString(),
      correlationId: orderId,
      actor: { type: "system" as const, id: "test" },
      source: "test",
      version: 1,
      payload: {
        orderId,
        orgId,
        items: [{ productId, name: "dupevent", qty: 3, unitPrice: 10 }],
      },
    } as unknown as EventEnvelope;

    await Promise.all([worker.handle(event), worker.handle(event)]);

    // Movements are keyed per order line (`eventId:line:index`) so a
    // multi-line order records one movement per line rather than tripping the
    // per-event uniqueness guard after its first line. Match the prefix.
    const moves = await db
      .select()
      .from(inventoryMovements)
      .where(like(inventoryMovements.eventId, `${event.eventId}:%`));
    expect(moves).toHaveLength(1);
    expect(await stockAt(productId, locationId)).toBe(17);
  });
});

// ---------------------------------------------------------------------------
// 6.3 (f) Two simultaneous refunds of the same order must not exceed
// settledTotal. Exercised through the real Express route so the ceiling check,
// the transaction, and the response all run as they do in production; only the
// auth/org-scope middleware is stubbed.
// ---------------------------------------------------------------------------
describe.skipIf(!hasDb)("6.3 simultaneous refunds of one order", () => {
  const cashierUserId = "race-cashier";

  function buildApp() {
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
    return app;
  }

  it("total refunded never exceeds the settled total", async () => {
    // FINDING CANDIDATE: the ceiling check (prior refunds + requested vs
    // settledTotal) runs on `db` OUTSIDE the transaction that inserts the
    // refund, and takes no lock on the order, so concurrent refunds each see
    // zero prior refunds.
    await db
      .insert(shifts)
      .values({ orgId, locationId, userId: cashierUserId, status: "open", openingFloat: "0" })
      .onConflictDoNothing();

    const productId = await makeProduct("refund", 100);
    const orderId = await makeOrderRow("30.00");
    const [line] = await db
      .insert(orderItems)
      .values({
        orgId,
        orderId,
        productId,
        quantity: 3,
        unitPrice: "10.00",
        totalPrice: "30.00",
      })
      .returning();

    const app = buildApp();
    const fire = () =>
      request(app)
        .post(`/api/orders/${orderId}/refunds`)
        .send({
          reason: "damaged",
          refundMethod: "cash",
          lines: [{ orderLineId: line.id, qty: 3 }],
        });

    const responses = await Promise.all([fire(), fire(), fire()]);
    const created = responses.filter((r) => r.status === 201).length;

    const rows = await db
      .select({ total: refunds.total })
      .from(refunds)
      .where(eq(refunds.orderId, orderId));
    const refundedTotal = rows.reduce((s, r) => s + parseFloat(String(r.total)), 0);

    const lineRows = await db
      .select({ qty: refundLines.qty })
      .from(refundLines)
      .innerJoin(refunds, eq(refundLines.refundId, refunds.id))
      .where(eq(refunds.orderId, orderId));
    const refundedQty = lineRows.reduce((s, r) => s + r.qty, 0);

    // The money invariant first — it is the one that costs real cash.
    expect(refundedTotal).toBeLessThanOrEqual(30);
    // And never more units than were sold.
    expect(refundedQty).toBeLessThanOrEqual(3);
    expect(created).toBe(1);
  });
});
