/**
 * Product edits (v1.2 Phase 0B, FIX-02 / PRC-F4): validated, £0 saves, stock
 * and unknown fields are ignored, and a cashier never sees cost.
 *
 * Runs against a real database, in CI's unit-db job by explicit file name.
 */
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("product write routes", () => {
  let db: (typeof import("../db"))["db"];
  let schema: typeof import("@shared/schema");
  let app: express.Express;
  let role = "MANAGER";
  const orgId = randomUUID();
  let locationId: string;
  let productId: string;

  beforeAll(async () => {
    process.env.DEV_AUTH_BYPASS = "0";
    ({ db } = await import("../db"));
    schema = await import("@shared/schema");
    await db.insert(schema.organizations).values({ id: orgId, name: "ZZ Product Writes Test" });
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
      req.user = { id: `test-${role.toLowerCase()}`, role, claims: { sub: `test-${role.toLowerCase()}` } };
      next();
    };
    const { registerProductRoutes } = await import("../routes/products");
    app = express();
    app.use(express.json());
    registerProductRoutes(app, [scoped]);
  });

  beforeEach(async () => {
    role = "MANAGER";
    const [p] = await db
      .insert(schema.products)
      .values({
        orgId,
        name: "Widget",
        productId: `W-${randomUUID().slice(0, 8)}`,
        defaultSalePrice: "20.00",
        costPrice: "13.37",
        stock: 7,
      })
      .returning();
    productId = p.id;
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.products).where(eq(schema.products.orgId, orgId));
    await db.delete(schema.locations).where(eq(schema.locations.orgId, orgId));
    await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId));
  });

  async function row() {
    const [p] = await db.select().from(schema.products).where(eq(schema.products.id, productId));
    return p;
  }

  it("saves a price and a cost of £0", async () => {
    await request(app).put(`/api/products/${productId}`).send({ salePrice: 0, costPrice: 0 }).expect(200);
    const p = await row();
    expect(p.defaultSalePrice).toBe("0.00");
    expect(p.costPrice).toBe("0.00");
  });

  it("clears a cost sent as null (unknown) and keeps it when the key is absent", async () => {
    await request(app).put(`/api/products/${productId}`).send({ name: "Widget 2" }).expect(200);
    expect((await row()).costPrice).toBe("13.37");
    await request(app).put(`/api/products/${productId}`).send({ costPrice: null }).expect(200);
    expect((await row()).costPrice).toBeNull();
  });

  it("creates with a blank cost as unknown (NULL), the same as an edit does, and keeps £0 as £0", async () => {
    const blank = await request(app)
      .post("/api/products")
      .send({ name: "No Cost Yet", salePrice: 5, costPrice: null, categoryId: "" })
      .expect(200);
    const empty = await request(app).post("/api/products").send({ name: "Empty Cost", salePrice: 5, costPrice: "" }).expect(200);
    const free = await request(app).post("/api/products").send({ name: "Free Sample", salePrice: 5, costPrice: 0 }).expect(200);
    const cost = async (id: string) =>
      (await db.select().from(schema.products).where(eq(schema.products.id, id)))[0].costPrice;
    expect(await cost(blank.body.id)).toBeNull();
    expect(await cost(empty.body.id)).toBeNull();
    expect(await cost(free.body.id)).toBe("0.00");
  });

  it("ignores stock and strips fields the table does not have, such as categoryId", async () => {
    await request(app)
      .put(`/api/products/${productId}`)
      .send({ name: "Renamed", stock: 999, categoryId: "", somethingElse: "x", salePrice: "4.50" })
      .expect(200);
    const p = await row();
    expect(p.name).toBe("Renamed");
    expect(p.stock).toBe(7);
    expect(p.defaultSalePrice).toBe("4.50");
  });

  it("refuses a negative or non-numeric price", async () => {
    await request(app).put(`/api/products/${productId}`).send({ salePrice: -1 }).expect(400);
    await request(app).put(`/api/products/${productId}`).send({ costPrice: "abc" }).expect(400);
    expect((await row()).defaultSalePrice).toBe("20.00");
  });

  it("refuses every write from a cashier", async () => {
    role = "CASHIER";
    await request(app).put(`/api/products/${productId}`).send({ salePrice: 1 }).expect(403);
    await request(app).post("/api/products").send({ name: "New", salePrice: 1 }).expect(403);
    await request(app).patch(`/api/products/${productId}/aliases`).send({ aliases: ["w"] }).expect(403);
    await request(app).delete(`/api/products/${productId}`).expect(403);
    expect((await row()).defaultSalePrice).toBe("20.00");
  });

  it("shows cost to a manager and never to a cashier", async () => {
    const asManager = await request(app).get(`/api/products/${productId}`).expect(200);
    expect(asManager.body.costPrice).toBe("13.37");
    role = "CASHIER";
    const asCashier = await request(app).get(`/api/products/${productId}`).expect(200);
    expect(asCashier.body).not.toHaveProperty("costPrice");
    expect(asCashier.body.name).toBe("Widget");
    const list = await request(app).get("/api/products").expect(200);
    expect(JSON.stringify(list.body)).not.toContain("13.37");
  });
});
