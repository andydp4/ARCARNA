/**
 * Stock Centre (v1.2 Phase 3) against a real database:
 *  - Suppliers: each mapping carries the product-card cost beside the
 *    supplier price, and the >2% / missing flag is worked out on the server.
 *  - Stock levels: the cashier's read-only view answers from their location
 *    and never carries a cost.
 *
 * In CI's unit-db job by explicit file name.
 */
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  locations,
  organizations,
  productLocationStock,
  productSuppliers,
  products,
  suppliers,
} from "@shared/schema";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("Stock Centre", () => {
  let db: (typeof import("../db"))["db"];
  let orgId: string;
  let locationId: string;
  let supplierId: string;

  async function product(name: string, costPrice: string | null, stock: number) {
    const [row] = await db
      .insert(products)
      .values({
        orgId,
        locationId,
        name,
        productId: `SC-${randomUUID().slice(0, 8)}`,
        defaultSalePrice: "2.00",
        costPrice,
      })
      .returning();
    await db.insert(productLocationStock).values({ orgId, productId: row.id, locationId, stock, stockLimit: 20 });
    return row;
  }

  beforeEach(async () => {
    ({ db } = await import("../db"));
    orgId = randomUUID();
    await db.insert(organizations).values({ id: orgId, name: "Stock Centre Test" });
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
    const [sup] = await db.insert(suppliers).values({ orgId, name: "Wholesaler", leadTimeDays: 2, isActive: 1 }).returning();
    supplierId = sup.id;
  });

  afterEach(async () => {
    await db.delete(productSuppliers).where(eq(productSuppliers.orgId, orgId));
    await db.delete(productLocationStock).where(eq(productLocationStock.orgId, orgId));
    await db.delete(products).where(eq(products.orgId, orgId));
    await db.delete(suppliers).where(eq(suppliers.orgId, orgId));
    await db.delete(locations).where(eq(locations.orgId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("puts the card cost beside the supplier price and flags gaps over 2% or a missing price", async () => {
    const close = await product("Close", "1.00", 5);
    const far = await product("Far", "1.00", 5);
    const noCard = await product("No card cost", null, 5);
    await db.insert(productSuppliers).values([
      { orgId, productId: close.id, supplierId, costPrice: "1.02" },
      { orgId, productId: far.id, supplierId, costPrice: "1.10" },
      { orgId, productId: noCard.id, supplierId, costPrice: "3.00" },
    ]);

    const { listProductSuppliers } = await import("../services/suppliers");
    const rows = await listProductSuppliers(orgId, undefined, supplierId);
    const byName = Object.fromEntries(rows.map((r) => [r.productName, r]));

    expect(byName["Close"].productCostPrice).toBe("1.00");
    expect(byName["Close"].costCheck).toMatchObject({ status: "match", flagged: false, diffPercent: 2 });
    expect(byName["Far"].costCheck).toMatchObject({ status: "differs", flagged: true, diffPercent: 10 });
    expect(byName["No card cost"].costCheck).toMatchObject({ status: "missing-card", flagged: true });
  });

  it("answers a cashier's Stock levels from their location, with no cost anywhere in the body", async () => {
    await product("Canary", "13.37", 3);
    await product("Plenty", "13.37", 18);

    const scoped: RequestHandler = (req: any, _res, next) => {
      req.orgContext = { orgId, locationId, role: "CASHIER" };
      req.user = { id: "stock-centre-cashier", role: "CASHIER", claims: { sub: "stock-centre-cashier" } };
      next();
    };
    const { registerInventoryRoutes } = await import("../routes/inventory");
    const app = express();
    app.use(express.json());
    registerInventoryRoutes(app, [scoped]);

    const res = await request(app).get("/api/stock-levels").expect(200);
    expect(res.text).not.toContain("13.37");
    expect(res.text).not.toMatch(/cost/i);
    const byName = Object.fromEntries((res.body as Array<{ name: string }>).map((r) => [r.name, r]));
    expect(byName["Canary"]).toMatchObject({ stock: 3, status: "low" });
    expect(byName["Plenty"]).toMatchObject({ stock: 18, status: "ok" });
  });
});
