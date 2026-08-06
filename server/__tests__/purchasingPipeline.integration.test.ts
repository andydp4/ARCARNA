/**
 * Integration test for the replenishment → purchase draft → receiving seams
 * against a real Postgres DB. Covers the SQL-backed behaviour that the pure
 * unit tests in replenishmentPipeline.test.ts cannot reach: on-order
 * aggregation, open-draft lookup, batch atomicity, and the receive cycle.
 *
 * Excluded from the unit run when DATABASE_URL is unset (see vitest.config.ts),
 * mirroring orderOutboxAtomicity.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and, inArray } from "drizzle-orm";
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
  inventoryMovements,
} from "@shared/schema";
import {
  getOnOrderQuantities,
  findOpenDraftsForPairs,
  createPurchaseDraftsBatch,
  setPurchaseDraftStatus,
  onOrderKey,
} from "../services/purchaseDrafts";
import { createPurchaseDraftsFromRecommendations } from "../services/replenishment";
import {
  createGoodsReceipt,
  completeGoodsReceipt,
  getPurchaseDraftReceiving,
} from "../services/goodsReceipts";

const hasDb = !!process.env.DATABASE_URL;

let orgId: string;
let otherOrgId: string;
let locationId: string;
let otherLocationId: string;
let supplierA: string;
let supplierB: string;
let productA: string;
let productB: string;

const createdOrgIds: string[] = [];

async function makeOrg(name: string) {
  const [org] = await db.insert(organizations).values({ name }).returning();
  createdOrgIds.push(org.id);
  return org.id;
}

async function makeLocation(org: string, name: string) {
  const [loc] = await db
    .insert(locations)
    .values({
      orgId: org,
      name,
      address: "1 Test Street",
      city: "Testville",
      state: "TS",
      zipCode: "TS1",
      phone: "0000000000",
      email: "loc@example.com",
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

async function makeSupplier(org: string, name: string) {
  const [s] = await db
    .insert(suppliers)
    .values({ orgId: org, name, leadTimeDays: 3, isActive: 1 })
    .returning();
  return s.id;
}

async function onOrderFor(org: string, productId: string, locId: string) {
  const map = await getOnOrderQuantities(org);
  return map.get(onOrderKey(productId, locId)) ?? 0;
}

/**
 * Removes drafts so a test's on-order totals do not leak into the next one.
 * `goods_receipts.purchase_draft_id` has no cascade and receipt items reference
 * draft items, so receipts must go first.
 */
async function cleanupDrafts(ids: (string | undefined)[]) {
  const draftIds = ids.filter((id): id is string => !!id);
  if (!draftIds.length) return;
  await db.delete(goodsReceipts).where(inArray(goodsReceipts.purchaseDraftId, draftIds));
  await db.delete(purchaseDrafts).where(inArray(purchaseDrafts.id, draftIds));
}

beforeAll(async () => {
  if (!hasDb) return;
  orgId = await makeOrg(`Purchasing Pipeline Test ${Date.now()}`);
  otherOrgId = await makeOrg(`Purchasing Pipeline Other ${Date.now()}`);

  locationId = await makeLocation(orgId, "Main");
  otherLocationId = await makeLocation(orgId, "Annex");

  productA = await makeProduct(orgId, locationId, "Widget A", `WA-${Date.now()}`);
  productB = await makeProduct(orgId, locationId, "Widget B", `WB-${Date.now()}`);

  supplierA = await makeSupplier(orgId, "Supplier A");
  supplierB = await makeSupplier(orgId, "Supplier B");

  await db.insert(productLocationStock).values([
    { orgId, productId: productA, locationId, stock: 10, stockLimit: 100 },
    { orgId, productId: productB, locationId, stock: 5, stockLimit: 100 },
  ]);
});

afterAll(async () => {
  if (!hasDb || !createdOrgIds.length) return;
  // Several of these tables reference organizations without ON DELETE CASCADE,
  // so tear down in explicit dependency order rather than relying on the org
  // delete to sweep up. goods_receipt_items and purchase_draft_items do cascade
  // from their parents.
  const inOrgs = createdOrgIds;
  await db.delete(inventoryMovements).where(inArray(inventoryMovements.orgId, inOrgs));
  await db.delete(goodsReceipts).where(inArray(goodsReceipts.orgId, inOrgs));
  await db.delete(purchaseDrafts).where(inArray(purchaseDrafts.orgId, inOrgs));
  await db.delete(productLocationStock).where(inArray(productLocationStock.orgId, inOrgs));
  await db.delete(products).where(inArray(products.orgId, inOrgs));
  await db.delete(suppliers).where(inArray(suppliers.orgId, inOrgs));
  await db.delete(locations).where(inArray(locations.orgId, inOrgs));
  await db.delete(organizations).where(inArray(organizations.id, inOrgs));
});

describe.skipIf(!hasDb)("getOnOrderQuantities", () => {
  it("sums outstanding quantity per product and location across open drafts", async () => {
    const [draft] = await createPurchaseDraftsBatch(orgId, [
      {
        supplierId: supplierA,
        locationId,
        items: [
          { productId: productA, quantity: 20.5 },
          { productId: productB, quantity: 7.25 },
        ],
      },
    ]);

    expect(await onOrderFor(orgId, productA, locationId)).toBe(20.5);
    expect(await onOrderFor(orgId, productB, locationId)).toBe(7.25);

    await cleanupDrafts([draft!.id]);
  });

  it("keys by location, so the same product at another location is separate", async () => {
    await db.insert(productLocationStock).values({
      orgId,
      productId: productA,
      locationId: otherLocationId,
      stock: 0,
      stockLimit: 50,
    });

    const drafts = await createPurchaseDraftsBatch(orgId, [
      { supplierId: supplierA, locationId, items: [{ productId: productA, quantity: 4 }] },
      {
        supplierId: supplierA,
        locationId: otherLocationId,
        items: [{ productId: productA, quantity: 9 }],
      },
    ]);

    expect(await onOrderFor(orgId, productA, locationId)).toBe(4);
    expect(await onOrderFor(orgId, productA, otherLocationId)).toBe(9);

    await cleanupDrafts(drafts.map((d) => d!.id));
  });

  it("counts unapproved drafts, which is what stops a duplicate order", async () => {
    const [draft] = await createPurchaseDraftsBatch(orgId, [
      { supplierId: supplierA, locationId, items: [{ productId: productA, quantity: 15 }] },
    ]);
    const [row] = await db
      .select({ status: purchaseDrafts.status })
      .from(purchaseDrafts)
      .where(eq(purchaseDrafts.id, draft!.id));

    expect(row.status).toBe("draft");
    expect(await onOrderFor(orgId, productA, locationId)).toBe(15);

    await cleanupDrafts([draft!.id]);
  });

  it("stops counting a cancelled draft, restoring the recommendation", async () => {
    const [draft] = await createPurchaseDraftsBatch(orgId, [
      { supplierId: supplierA, locationId, items: [{ productId: productA, quantity: 11 }] },
    ]);
    expect(await onOrderFor(orgId, productA, locationId)).toBe(11);

    await setPurchaseDraftStatus(orgId, draft!.id, "cancelled");
    expect(await onOrderFor(orgId, productA, locationId)).toBe(0);

    await cleanupDrafts([draft!.id]);
  });

  it("nets off quantity already received rather than the full ordered quantity", async () => {
    const [draft] = await createPurchaseDraftsBatch(orgId, [
      { supplierId: supplierA, locationId, items: [{ productId: productA, quantity: 10.5 }] },
    ]);
    const [line] = await db
      .select()
      .from(purchaseDraftItems)
      .where(eq(purchaseDraftItems.purchaseDraftId, draft!.id));

    await db
      .update(purchaseDraftItems)
      .set({ quantityReceived: 4.25 })
      .where(eq(purchaseDraftItems.id, line.id));

    expect(await onOrderFor(orgId, productA, locationId)).toBe(6.25);

    // Over-received rows must clamp at zero, never go negative.
    await db
      .update(purchaseDraftItems)
      .set({ quantityReceived: 25 })
      .where(eq(purchaseDraftItems.id, line.id));
    expect(await onOrderFor(orgId, productA, locationId)).toBe(0);

    await cleanupDrafts([draft!.id]);
  });

  it("is org-scoped — another org's drafts never leak in", async () => {
    const otherLoc = await makeLocation(otherOrgId, "Other Main");
    const otherProduct = await makeProduct(otherOrgId, otherLoc, "Other Widget", `OW-${Date.now()}`);
    const otherSupplier = await makeSupplier(otherOrgId, "Other Supplier");

    const [otherDraft] = await createPurchaseDraftsBatch(otherOrgId, [
      {
        supplierId: otherSupplier,
        locationId: otherLoc,
        items: [{ productId: otherProduct, quantity: 99 }],
      },
    ]);

    const ourMap = await getOnOrderQuantities(orgId);
    expect(ourMap.get(onOrderKey(otherProduct, otherLoc))).toBeUndefined();

    const theirMap = await getOnOrderQuantities(otherOrgId);
    expect(theirMap.get(onOrderKey(otherProduct, otherLoc))).toBe(99);

    await cleanupDrafts([otherDraft!.id]);
  });
});

describe.skipIf(!hasDb)("findOpenDraftsForPairs", () => {
  it("returns only drafts matching a requested supplier+location pair", async () => {
    // supplierA@location and supplierB@otherLocation exist; asking for the
    // cross pair (supplierA@otherLocation) must not match either.
    const drafts = await createPurchaseDraftsBatch(orgId, [
      { supplierId: supplierA, locationId, items: [{ productId: productA, quantity: 3 }] },
      {
        supplierId: supplierB,
        locationId: otherLocationId,
        items: [{ productId: productA, quantity: 3 }],
      },
    ]);

    const crossPair = await findOpenDraftsForPairs(orgId, [
      { supplierId: supplierA, locationId: otherLocationId },
    ]);
    expect(crossPair).toHaveLength(0);

    const realPair = await findOpenDraftsForPairs(orgId, [{ supplierId: supplierA, locationId }]);
    expect(realPair).toHaveLength(1);
    expect(realPair[0].supplierId).toBe(supplierA);
    expect(realPair[0].locationId).toBe(locationId);

    await cleanupDrafts(drafts.map((d) => d!.id));
  });

  it("returns nothing for an empty pair list without querying", async () => {
    expect(await findOpenDraftsForPairs(orgId, [])).toEqual([]);
  });

  it("ignores closed drafts", async () => {
    const [draft] = await createPurchaseDraftsBatch(orgId, [
      { supplierId: supplierA, locationId, items: [{ productId: productA, quantity: 2 }] },
    ]);
    await setPurchaseDraftStatus(orgId, draft!.id, "cancelled");

    const found = await findOpenDraftsForPairs(orgId, [{ supplierId: supplierA, locationId }]);
    expect(found).toHaveLength(0);

    await cleanupDrafts([draft!.id]);
  });
});

describe.skipIf(!hasDb)("createPurchaseDraftsBatch", () => {
  it("commits every group together", async () => {
    const drafts = await createPurchaseDraftsBatch(orgId, [
      { supplierId: supplierA, locationId, items: [{ productId: productA, quantity: 2 }] },
      { supplierId: supplierB, locationId, items: [{ productId: productB, quantity: 3 }] },
    ]);

    expect(drafts).toHaveLength(2);
    const stored = await db
      .select()
      .from(purchaseDrafts)
      .where(
        inArray(
          purchaseDrafts.id,
          drafts.map((d) => d!.id),
        ),
      );
    expect(stored).toHaveLength(2);

    await cleanupDrafts(drafts.map((d) => d!.id));
  });

  it("rolls back an earlier group when a later one is invalid", async () => {
    const before = await db.select().from(purchaseDrafts).where(eq(purchaseDrafts.orgId, orgId));

    await expect(
      createPurchaseDraftsBatch(orgId, [
        { supplierId: supplierA, locationId, items: [{ productId: productA, quantity: 5 }] },
        { supplierId: supplierB, locationId, items: [{ productId: productB, quantity: 0 }] },
      ]),
    ).rejects.toThrow(/positive/i);

    const after = await db.select().from(purchaseDrafts).where(eq(purchaseDrafts.orgId, orgId));
    expect(after).toHaveLength(before.length);
  });

  it("rejects an empty batch", async () => {
    await expect(createPurchaseDraftsBatch(orgId, [])).rejects.toThrow(/at least one/i);
  });
});

describe.skipIf(!hasDb)("createPurchaseDraftsFromRecommendations", () => {
  it("groups lines into one draft per supplier and scopes provenance to each", async () => {
    const result = await createPurchaseDraftsFromRecommendations(orgId, {
      lines: [
        {
          supplierId: supplierA,
          locationId,
          productId: productA,
          quantity: 12,
          estimatedCost: 3.5,
          supplierSku: "A-1",
          recommendation: { productName: "Widget A", explain: { whyAction: "from A" } },
        },
        {
          supplierId: supplierA,
          locationId,
          productId: productB,
          quantity: 4,
          recommendation: { productName: "Widget B", explain: { whyAction: "also A" } },
        },
        {
          supplierId: supplierB,
          locationId,
          productId: productB,
          quantity: 6,
          recommendation: { productName: "Widget B", explain: { whyAction: "from B" } },
        },
      ],
    });

    expect(result.created).toBe(2);
    expect(result.lineCount).toBe(3);

    const draftA = result.drafts.find((d) => d!.supplierId === supplierA)!;
    const draftB = result.drafts.find((d) => d!.supplierId === supplierB)!;
    expect(draftA.items).toHaveLength(2);
    expect(draftB.items).toHaveLength(1);

    const provA = (draftA.sourceRecommendationJson as { recommendations: unknown[] })
      .recommendations;
    const provB = (draftB.sourceRecommendationJson as {
      recommendations: { explain: { whyAction: string } }[];
    }).recommendations;
    expect(provA).toHaveLength(2);
    expect(provB).toHaveLength(1);
    expect(provB[0].explain.whyAction).toBe("from B");

    const lineA = draftA.items.find((i) => i.productId === productA)!;
    expect(lineA.estimatedCost).toBe("3.50");
    expect(lineA.supplierSku).toBe("A-1");

    await cleanupDrafts(result.drafts.map((d) => d!.id));
  });

  it("reports pre-existing open drafts for the same supplier and location", async () => {
    const first = await createPurchaseDraftsFromRecommendations(orgId, {
      lines: [{ supplierId: supplierA, locationId, productId: productA, quantity: 5 }],
    });
    expect(first.existingOpenDrafts).toHaveLength(0);

    const second = await createPurchaseDraftsFromRecommendations(orgId, {
      lines: [{ supplierId: supplierA, locationId, productId: productA, quantity: 5 }],
    });
    expect(second.existingOpenDrafts.map((d) => d.id)).toContain(first.drafts[0]!.id);

    await cleanupDrafts([first.drafts[0]!.id, second.drafts[0]!.id]);
  });
});

describe.skipIf(!hasDb)("receive cycle", () => {
  it("moves stock only on completion and reduces on-order as goods arrive", async () => {
    const [draft] = await createPurchaseDraftsBatch(orgId, [
      { supplierId: supplierA, locationId, items: [{ productId: productA, quantity: 10.5 }] },
    ]);
    const draftId = draft!.id;

    await setPurchaseDraftStatus(orgId, draftId, "reviewed");
    await setPurchaseDraftStatus(orgId, draftId, "approved");

    const [stockBefore] = await db
      .select()
      .from(productLocationStock)
      .where(
        and(
          eq(productLocationStock.productId, productA),
          eq(productLocationStock.locationId, locationId),
        ),
      );
    const startingStock = stockBefore.stock;

    const receiving = await getPurchaseDraftReceiving(orgId, draftId);
    const line = receiving.items[0];
    expect(line.remaining).toBe(10.5);

    const receipt = await createGoodsReceipt(orgId, {
      purchaseDraftId: draftId,
      items: [
        {
          purchaseDraftItemId: line.id,
          productId: productA,
          quantityReceived: 4.5,
          quantityDamaged: 0.5,
        },
      ],
    });
    expect(receipt!.status).toBe("pending");

    // Pending holds the quantity against the line but must not touch stock.
    const [stockPending] = await db
      .select()
      .from(productLocationStock)
      .where(
        and(
          eq(productLocationStock.productId, productA),
          eq(productLocationStock.locationId, locationId),
        ),
      );
    expect(stockPending.stock).toBe(startingStock);

    const mid = await getPurchaseDraftReceiving(orgId, draftId);
    expect(mid.items[0].pendingOnReceipts).toBe(4.5);
    expect(mid.items[0].remaining).toBe(6);

    await completeGoodsReceipt(orgId, receipt!.id, "test");

    const [stockAfter] = await db
      .select()
      .from(productLocationStock)
      .where(
        and(
          eq(productLocationStock.productId, productA),
          eq(productLocationStock.locationId, locationId),
        ),
      );
    // Damaged units are recorded but never become sellable stock.
    expect(stockAfter.stock).toBe(startingStock + 4.5);

    const [draftAfter] = await db
      .select()
      .from(purchaseDrafts)
      .where(eq(purchaseDrafts.id, draftId));
    expect(draftAfter.status).toBe("partially_received");

    expect(await onOrderFor(orgId, productA, locationId)).toBe(6);

    // Completing twice must not double-count stock.
    const again = await completeGoodsReceipt(orgId, receipt!.id, "test");
    expect(again.idempotent).toBe(true);
    const [stockIdem] = await db
      .select()
      .from(productLocationStock)
      .where(
        and(
          eq(productLocationStock.productId, productA),
          eq(productLocationStock.locationId, locationId),
        ),
      );
    expect(stockIdem.stock).toBe(startingStock + 4.5);

    await cleanupDrafts([draftId]);
  });

  it("drops a fully received draft out of the on-order total", async () => {
    const [draft] = await createPurchaseDraftsBatch(orgId, [
      { supplierId: supplierB, locationId, items: [{ productId: productB, quantity: 3 }] },
    ]);
    const draftId = draft!.id;

    await setPurchaseDraftStatus(orgId, draftId, "reviewed");
    await setPurchaseDraftStatus(orgId, draftId, "approved");
    expect(await onOrderFor(orgId, productB, locationId)).toBe(3);

    const receiving = await getPurchaseDraftReceiving(orgId, draftId);
    const receipt = await createGoodsReceipt(orgId, {
      purchaseDraftId: draftId,
      items: [
        {
          purchaseDraftItemId: receiving.items[0].id,
          productId: productB,
          quantityReceived: 3,
        },
      ],
    });
    await completeGoodsReceipt(orgId, receipt!.id, "test");

    const [draftAfter] = await db
      .select()
      .from(purchaseDrafts)
      .where(eq(purchaseDrafts.id, draftId));
    expect(draftAfter.status).toBe("fully_received");
    expect(await onOrderFor(orgId, productB, locationId)).toBe(0);

    await cleanupDrafts([draftId]);
  });

  it("refuses to receive against a draft that is not approved", async () => {
    const [draft] = await createPurchaseDraftsBatch(orgId, [
      { supplierId: supplierA, locationId, items: [{ productId: productA, quantity: 5 }] },
    ]);
    const receiving = await getPurchaseDraftReceiving(orgId, draft!.id);

    await expect(
      createGoodsReceipt(orgId, {
        purchaseDraftId: draft!.id,
        items: [
          {
            purchaseDraftItemId: receiving.items[0].id,
            productId: productA,
            quantityReceived: 1,
          },
        ],
      }),
    ).rejects.toThrow(/approved or partially received/i);

    await cleanupDrafts([draft!.id]);
  });
});
