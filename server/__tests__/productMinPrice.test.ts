/**
 * Minimum price, cost clean-up and price history (v1.2 Phase 2: PRC-01,
 * PRC-07, PRC-F3), through the real product routes and import.
 *
 * Runs against a real database, in CI's unit-db job by explicit file name.
 */
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { effectiveFloor } from "@shared/pricing/floor";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("minimum price, cost and price history", () => {
  let db: (typeof import("../db"))["db"];
  let schema: typeof import("@shared/schema");
  let storage: (typeof import("../storage"))["storage"];
  let app: express.Express;
  let role = "MANAGER";
  const orgId = randomUUID();
  const actorId = `test-min-price-${randomUUID().slice(0, 8)}`;
  let locationId: string;
  let productId: string;
  let sku: string;

  beforeAll(async () => {
    process.env.DEV_AUTH_BYPASS = "0";
    ({ db } = await import("../db"));
    ({ storage } = await import("../storage"));
    schema = await import("@shared/schema");
    await db.insert(schema.organizations).values({ id: orgId, name: "ZZ Min Price Test" });
    const [loc] = await db
      .insert(schema.locations)
      .values({
        orgId,
        name: "Main",
        address: "1 Test Street",
        city: "Testville",
        state: "TS",
        zipCode: "TS1",
        phone: "0000000000",
        email: "loc@example.com",
        isDefault: 1,
      })
      .returning();
    locationId = loc.id;

    const scoped: RequestHandler = (req: any, _res, next) => {
      req.orgContext = { orgId, locationId, role };
      req.user = { id: actorId, role, claims: { sub: actorId } };
      next();
    };
    const { registerProductRoutes } = await import("../routes/products");
    app = express();
    app.use(express.json());
    registerProductRoutes(app, [scoped]);
  });

  beforeEach(async () => {
    role = "MANAGER";
    sku = `MP-${randomUUID().slice(0, 8)}`;
    const [p] = await db
      .insert(schema.products)
      .values({ orgId, name: "Widget", productId: sku, defaultSalePrice: "4.50", costPrice: "2.00" })
      .returning();
    productId = p.id;
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.productPriceHistory).where(eq(schema.productPriceHistory.orgId, orgId));
    await db.delete(schema.inventoryMovements).where(eq(schema.inventoryMovements.orgId, orgId));
    await db.delete(schema.productLocationStock).where(eq(schema.productLocationStock.orgId, orgId));
    await db.delete(schema.products).where(eq(schema.products.orgId, orgId));
    await db.delete(schema.locations).where(eq(schema.locations.orgId, orgId));
    await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId));
  });

  async function row(id = productId) {
    const [p] = await db.select().from(schema.products).where(eq(schema.products.id, id));
    return p;
  }

  async function history(id = productId) {
    return db
      .select()
      .from(schema.productPriceHistory)
      .where(eq(schema.productPriceHistory.productId, id))
      .orderBy(asc(schema.productPriceHistory.createdAt), asc(schema.productPriceHistory.field));
  }

  it("is empty by default and follows the sale price as it changes", async () => {
    expect((await row()).minPrice).toBeNull();
    expect(effectiveFloor(await row()).floor).toBe(4.5);
    await request(app).put(`/api/products/${productId}`).send({ salePrice: 3.99 }).expect(200);
    const p = await row();
    expect(p.minPrice).toBeNull();
    expect(effectiveFloor(p)).toMatchObject({ floor: 3.99, followsSalePrice: true });
  });

  it("saves a minimum at or below the sale price, and clears it with null", async () => {
    await request(app).put(`/api/products/${productId}`).send({ minPrice: "4.00" }).expect(200);
    expect((await row()).minPrice).toBe("4.00");
    await request(app).put(`/api/products/${productId}`).send({ name: "Renamed" }).expect(200);
    expect((await row()).minPrice).toBe("4.00");
    await request(app).put(`/api/products/${productId}`).send({ minPrice: "" }).expect(200);
    expect((await row()).minPrice).toBeNull();
  });

  it("refuses a minimum above the sale price", async () => {
    const res = await request(app).put(`/api/products/${productId}`).send({ minPrice: 5 }).expect(400);
    expect(res.body.code).toBe("MIN_ABOVE_SALE");
    expect((await row()).minPrice).toBeNull();
    const created = await request(app).post("/api/products").send({ name: "New", salePrice: 2, minPrice: 3 }).expect(400);
    expect(created.body.code).toBe("MIN_ABOVE_SALE");
  });

  it("refuses lowering the sale price below a stored minimum unless the minimum comes down too", async () => {
    await request(app).put(`/api/products/${productId}`).send({ minPrice: 4 }).expect(200);
    const res = await request(app).put(`/api/products/${productId}`).send({ salePrice: 3.5 }).expect(400);
    expect(res.body.code).toBe("MIN_ABOVE_SALE");
    expect((await row()).defaultSalePrice).toBe("4.50");
    await request(app).put(`/api/products/${productId}`).send({ salePrice: 3.5, minPrice: 3.5 }).expect(200);
    const p = await row();
    expect(p.defaultSalePrice).toBe("3.50");
    expect(p.minPrice).toBe("3.50");
  });

  it("does not let a cashier set a minimum, at the route or in the service", async () => {
    role = "CASHIER";
    await request(app).put(`/api/products/${productId}`).send({ minPrice: 1 }).expect(403);
    const { updateProductWithPricing, ProductPricingError } = await import("../services/productPricing");
    await expect(
      updateProductWithPricing({ orgId, productId, patch: { minPrice: 1 }, role: "CASHIER", actorId }),
    ).rejects.toBeInstanceOf(ProductPricingError);
    expect((await row()).minPrice).toBeNull();
  });

  it("records sale, minimum and cost changes with old, new, who and source", async () => {
    await request(app)
      .put(`/api/products/${productId}`)
      .send({ salePrice: 5, minPrice: 4, costPrice: null, name: "Only prices are history" })
      .expect(200);
    const rows = await history();
    expect(rows.map((r) => [r.field, r.oldValue, r.newValue, r.source, r.changedBy])).toEqual([
      ["cost", "2.00", null, "form", actorId],
      ["min", null, "4.00", "form", actorId],
      ["sale", "4.50", "5.00", "form", actorId],
    ]);
    // A save that changes no price writes nothing.
    await request(app).put(`/api/products/${productId}`).send({ name: "Again", salePrice: 5 }).expect(200);
    expect(await history()).toHaveLength(3);
  });

  it("shows the price history to a manager and not to a cashier", async () => {
    await request(app).put(`/api/products/${productId}`).send({ salePrice: 6 }).expect(200);
    const res = await request(app).get(`/api/products/${productId}/price-history`).expect(200);
    expect(res.body[0]).toMatchObject({ field: "sale", oldValue: "4.50", newValue: "6.00", source: "form" });
    role = "CASHIER";
    await request(app).get(`/api/products/${productId}/price-history`).expect(403);
  });

  it("creates with no cost as unknown (NULL), not £0, and records the first prices", async () => {
    const res = await request(app).post("/api/products").send({ name: "No cost", salePrice: 3, minPrice: 2 }).expect(200);
    const p = await row(res.body.id);
    expect(p.costPrice).toBeNull();
    expect(p.minPrice).toBe("2.00");
    const rows = await history(res.body.id);
    expect(rows.map((r) => [r.field, r.oldValue, r.newValue, r.source])).toEqual([
      ["min", null, "2.00", "create"],
      ["sale", null, "3.00", "create"],
    ]);
  });

  describe("import", () => {
    const opts = () => ({ duplicateMode: "overwrite" as const, confirmed: true, role, actorId });

    it("sets a minimum from the column, keeps it on a blank cell and clears it on the token", async () => {
      let r = await storage.importProducts([{ name: "Widget", productId: sku, defaultSalePrice: "4.50", minPrice: "4.00" }], orgId, opts());
      expect(r).toMatchObject({ imported: 1, failed: 0 });
      expect((await row()).minPrice).toBe("4.00");

      r = await storage.importProducts([{ name: "Widget", productId: sku, defaultSalePrice: "4.50", minPrice: "" }], orgId, opts());
      expect(r.imported).toBe(1);
      expect((await row()).minPrice).toBe("4.00");

      r = await storage.importProducts([{ name: "Widget", productId: sku, defaultSalePrice: "4.50" }], orgId, opts());
      expect((await row()).minPrice).toBe("4.00");

      r = await storage.importProducts([{ name: "Widget", productId: sku, defaultSalePrice: "4.50", minPrice: "CLEAR" }], orgId, opts());
      expect(r.imported).toBe(1);
      expect((await row()).minPrice).toBeNull();

      const sources = (await history()).filter((h) => h.field === "min").map((h) => [h.oldValue, h.newValue, h.source]);
      expect(sources).toEqual([
        [null, "4.00", "import"],
        ["4.00", null, "import"],
      ]);
    });

    it("refuses a row whose minimum would sit above its sale price, including a kept one", async () => {
      await request(app).put(`/api/products/${productId}`).send({ minPrice: 4 }).expect(200);
      const r = await storage.importProducts([{ name: "Widget", productId: sku, defaultSalePrice: "3.00" }], orgId, opts());
      expect(r.failed).toBe(1);
      expect(r.errors[0]).toMatch(/above the sale price/);
      expect((await row()).defaultSalePrice).toBe("4.50");
    });

    it("refuses a minimum-price column from someone below manager", async () => {
      role = "CASHIER";
      const r = await storage.importProducts([{ name: "Widget", productId: sku, defaultSalePrice: "4.50", minPrice: "1" }], orgId, opts());
      expect(r.failed).toBe(1);
      expect((await row()).minPrice).toBeNull();
    });

    it("keeps an existing cost when an overwrite has no cost, and stores a new product's missing cost as unknown", async () => {
      await storage.importProducts([{ name: "Widget", productId: sku, defaultSalePrice: "4.75" }], orgId, opts());
      const kept = await row();
      expect(kept.costPrice).toBe("2.00");
      expect(kept.defaultSalePrice).toBe("4.75");

      const newSku = `MP-NEW-${randomUUID().slice(0, 6)}`;
      await storage.importProducts([{ name: "Fresh", productId: newSku, defaultSalePrice: "1.00" }], orgId, opts());
      const [fresh] = await db
        .select()
        .from(schema.products)
        .where(and(eq(schema.products.orgId, orgId), eq(schema.products.productId, newSku)));
      expect(fresh.costPrice).toBeNull();
      expect(fresh.minPrice).toBeNull();
    });
  });
});
