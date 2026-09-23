/**
 * Route-level checks for the purchase-draft / goods-receipt fixes: who may
 * call them, what gets audited, and that the purchase order the supplier
 * actually receives is priced (the owner's £0.00 PO).
 *
 * Runs against a real database, in CI's unit-db job by explicit file name.
 */
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  adminAuditLogs,
  goodsReceipts,
  inventoryMovements,
  locations,
  productLocationStock,
  organizations,
  products,
  purchaseDrafts,
  suppliers,
} from "@shared/schema";

// Capture what the route hands the PDF renderer instead of parsing a PDF.
const pdfCalls: Array<{ items: Array<{ unitCost: number | null }> }> = [];
vi.mock("../services/purchaseOrderExport", () => ({
  generatePurchaseOrderPdf: vi.fn(async (data: { items: Array<{ unitCost: number | null }> }) => {
    pdfCalls.push(data);
    return Buffer.from("%PDF-test");
  }),
}));
vi.mock("../services/companyBranding", () => ({
  loadCompanyInfo: vi.fn(async () => ({ name: "Test Buyer" })),
}));

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("purchase draft and goods receipt routes", () => {
  let db: (typeof import("../db"))["db"];
  let svc: typeof import("../services/purchaseDrafts");
  let orgId: string;
  let locationId: string;
  let supplierId: string;
  let productId: string;
  let role = "MANAGER";

  function makeApp() {
    const scoped: RequestHandler = (req: any, _res, next) => {
      req.orgContext = { orgId, locationId: null, role };
      req.user = { id: `test-${role.toLowerCase()}`, role, claims: { sub: `test-${role.toLowerCase()}` } };
      next();
    };
    return (async () => {
      const { registerPurchaseDraftRoutes } = await import("../routes/purchaseDrafts");
      const { registerGoodsReceiptRoutes } = await import("../routes/goodsReceipts");
      const app = express();
      app.use(express.json());
      registerPurchaseDraftRoutes(app, [scoped]);
      registerGoodsReceiptRoutes(app, [scoped]);
      return app;
    })();
  }

  async function approvedDraft(quantity: number) {
    const [draft] = await svc.createPurchaseDraftsBatch(orgId, [
      { supplierId, locationId, items: [{ productId, quantity }] },
    ]);
    await svc.setPurchaseDraftStatus(orgId, draft!.id, "reviewed");
    await svc.setPurchaseDraftStatus(orgId, draft!.id, "approved");
    const loaded = await svc.getPurchaseDraft(orgId, draft!.id);
    return { draftId: draft!.id, lineId: loaded!.items[0].id };
  }

  async function auditActions() {
    const rows = await db
      .select({ action: adminAuditLogs.action, metadata: adminAuditLogs.metadata })
      .from(adminAuditLogs)
      .where(eq(adminAuditLogs.orgId, orgId));
    return rows;
  }

  beforeEach(async () => {
    ({ db } = await import("../db"));
    svc = await import("../services/purchaseDrafts");
    role = "MANAGER";
    pdfCalls.length = 0;

    orgId = randomUUID();
    await db.insert(organizations).values({ id: orgId, name: "Purchasing Routes Test" });
    const [loc] = await db
      .insert(locations)
      .values({
        orgId,
        name: "Main",
        address: "1 Test Street",
        city: "Testville",
        state: "TS",
        zipCode: "TS1",
        phone: "0000000000",
        email: "loc@example.com",
      })
      .returning();
    locationId = loc.id;
    const [sup] = await db.insert(suppliers).values({ orgId, name: "Supplier", leadTimeDays: 2, isActive: 1 }).returning();
    supplierId = sup.id;
    const [prod] = await db
      .insert(products)
      .values({ orgId, locationId, name: "40435 G BL", productId: `GBL-${randomUUID().slice(0, 8)}`, defaultSalePrice: "0.30", costPrice: "0.11" })
      .returning();
    productId = prod.id;
  });

  afterEach(async () => {
    await db.delete(adminAuditLogs).where(eq(adminAuditLogs.orgId, orgId));
    const drafts = await db.select({ id: purchaseDrafts.id }).from(purchaseDrafts).where(eq(purchaseDrafts.orgId, orgId));
    if (drafts.length) {
      await db.delete(goodsReceipts).where(inArray(goodsReceipts.purchaseDraftId, drafts.map((d) => d.id)));
      await db.delete(purchaseDrafts).where(eq(purchaseDrafts.orgId, orgId));
    }
    await db.delete(inventoryMovements).where(eq(inventoryMovements.orgId, orgId));
    await db.delete(productLocationStock).where(eq(productLocationStock.orgId, orgId));
    await db.delete(products).where(eq(products.orgId, orgId));
    await db.delete(suppliers).where(eq(suppliers.orgId, orgId));
    await db.delete(locations).where(eq(locations.orgId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("prices the exported PO from the product card for a line saved without a cost — not £0", async () => {
    const { draftId, lineId } = await approvedDraft(10000);
    // A draft raised before the fallback existed: no cost on the line.
    const { purchaseDraftItems } = await import("@shared/schema");
    await db.update(purchaseDraftItems).set({ estimatedCost: null }).where(eq(purchaseDraftItems.id, lineId));

    const app = await makeApp();
    const res = await request(app).get(`/api/purchase-drafts/${draftId}/export`).expect(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(pdfCalls[0].items[0].unitCost).toBe(0.11);
  });

  it("refuses line edits and receipts from a cashier", async () => {
    const { draftId, lineId } = await approvedDraft(10);
    role = "CASHIER";
    const app = await makeApp();
    await request(app).patch(`/api/purchase-drafts/${draftId}/items/${lineId}`).send({ quantity: 12 }).expect(403);
    await request(app)
      .post("/api/goods-receipts")
      .send({ purchaseDraftId: draftId, items: [{ purchaseDraftItemId: lineId, productId, quantityReceived: 1 }] })
      .expect(403);
  });

  it("audits an amendment to an approved order only when something actually changed", async () => {
    const { draftId, lineId } = await approvedDraft(3864);
    const app = await makeApp();

    const same = await request(app).patch(`/api/purchase-drafts/${draftId}/items/${lineId}`).send({ quantity: 3864 }).expect(200);
    expect(same.body.amendedAfterApproval).toBe(false);
    expect(await auditActions()).toEqual([]);

    const changed = await request(app).patch(`/api/purchase-drafts/${draftId}/items/${lineId}`).send({ quantity: 10000 }).expect(200);
    expect(changed.body.amendedAfterApproval).toBe(true);
    const audits = await auditActions();
    expect(audits.map((a) => a.action)).toEqual(["purchase_draft.line_amended_after_approval"]);
    expect(audits[0].metadata).toMatchObject({ from: { quantity: 3864 }, to: { quantity: 10000 } });
  });

  it("rejects a unit cost of 0 — it would be read as 'no cost' everywhere", async () => {
    const { draftId, lineId } = await approvedDraft(5);
    const app = await makeApp();
    await request(app).patch(`/api/purchase-drafts/${draftId}/items/${lineId}`).send({ estimatedCost: 0 }).expect(400);
    await request(app).patch(`/api/purchase-drafts/${draftId}/items/${lineId}`).send({ estimatedCost: null }).expect(200);
  });

  it("asks before an over-delivery, then audits the confirmation and the raise at completion", async () => {
    const { draftId, lineId } = await approvedDraft(3864);
    const app = await makeApp();
    const body = { purchaseDraftId: draftId, items: [{ purchaseDraftItemId: lineId, productId, quantityReceived: 10000 }] };

    const refused = await request(app).post("/api/goods-receipts").send(body).expect(409);
    expect(refused.body.code).toBe("OVER_RECEIVE");

    const created = await request(app)
      .post("/api/goods-receipts")
      .send({ ...body, acceptOverDeliveryLineIds: [lineId] })
      .expect(201);
    expect((await auditActions()).map((a) => a.action)).toEqual(["goods_receipt.over_delivery_confirmed"]);

    const completed = await request(app).post(`/api/goods-receipts/${created.body.id}/complete`).send({}).expect(200);
    expect(completed.body.overDeliveryRaised).toEqual([
      { purchaseDraftItemId: lineId, orderedBefore: 3864, orderedAfter: 10000 },
    ]);
    const accepted = (await auditActions()).find((a) => a.action === "goods_receipt.over_delivery_accepted");
    expect(accepted?.metadata).toMatchObject({ lines: [{ orderedBefore: 3864, orderedAfter: 10000 }] });

    const rows = await db
      .select()
      .from(purchaseDrafts)
      .where(and(eq(purchaseDrafts.id, draftId), eq(purchaseDrafts.orgId, orgId)));
    expect(rows[0].status).toBe("fully_received");
  });
});
