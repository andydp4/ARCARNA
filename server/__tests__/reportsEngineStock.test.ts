/**
 * ARC-021: the Current Stock and Stock Runway reports read `products.stock`
 * directly, a legacy column that's always written as 0 (see storage.ts's
 * getProductsWithStock comment) — so every product on both reports showed as
 * CRITICAL / out of stock regardless of what was actually on the shelf, and
 * each one fired a spurious red flag. Real stock lives in
 * `product_location_stock`, summed per product across locations, which is
 * exactly what `storage.getProductsWithStock` already does for every other
 * stock-aware view in the app.
 *
 * This seeds a product with `products.stock = 0` but real stock recorded in
 * `product_location_stock`, and asserts both reports reflect the real
 * quantity rather than reading it as empty.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { inArray, eq } from "drizzle-orm";
import { locations, organizations, productLocationStock, products } from "@shared/schema";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("reportsEngine stock reports use real per-location stock", () => {
  let orgId: string;
  let locationId: string;
  let productId: string;
  let db: (typeof import("../db"))["db"];
  let currentStockLevels: (typeof import("../services/reportsEngine"))["currentStockLevels"];
  let stockRunwayForecast: (typeof import("../services/reportsEngine"))["stockRunwayForecast"];

  beforeEach(async () => {
    ({ db } = await import("../db"));
    ({ currentStockLevels, stockRunwayForecast } = await import("../services/reportsEngine"));

    orgId = randomUUID();
    locationId = randomUUID();
    productId = randomUUID();

    await db.insert(organizations).values({ id: orgId, name: "Reports Stock Test Org" });
    await db.insert(locations).values({
      id: locationId,
      orgId,
      name: "Main",
      address: "1 Test Street",
      city: "Testville",
      state: "Test",
      zipCode: "T1",
      phone: "000",
      email: "reports-stock@example.test",
      isDefault: 1,
    });
    // products.stock is deliberately left at its legacy default (0) — real
    // stock lives only in product_location_stock, as it does in production.
    await db.insert(products).values({
      id: productId,
      orgId,
      name: "Reports Stock Widget",
      productId: `RSW-${productId}`,
      defaultSalePrice: "10.00",
      stock: 0,
      stockLimit: 5,
    });
    await db.insert(productLocationStock).values({
      orgId,
      productId,
      locationId,
      stock: 40,
      stockLimit: 5,
    });
  });

  afterEach(async () => {
    await db.delete(productLocationStock).where(eq(productLocationStock.orgId, orgId));
    await db.delete(products).where(inArray(products.id, [productId]));
    await db.delete(locations).where(inArray(locations.id, [locationId]));
    await db.delete(organizations).where(inArray(organizations.id, [orgId]));
  });

  it("Current Stock Levels reports the real per-location total, not the legacy 0 column", async () => {
    const report = await currentStockLevels(orgId);
    const row = report.rows.find((r: any) => r.product === "Reports Stock Widget") as any;
    expect(row).toBeDefined();
    expect(row.unitsInStock).toBe(40);
    // 40 in stock against a par of 5 is comfortably GREEN, not CRITICAL.
    expect(row.status).toBe("GREEN");
    expect(report.redFlags.some((f) => f.includes("Reports Stock Widget"))).toBe(false);
  });

  it("Stock Runway & Demand Forecast reports the real per-location total, not the legacy 0 column", async () => {
    const report = await stockRunwayForecast(orgId);
    const row = report.rows.find((r: any) => r.product === "Reports Stock Widget") as any;
    expect(row).toBeDefined();
    expect(row.currentStock).toBe(40);
    // With no sales velocity recorded, real stock reads as "999 weeks left"
    // (comfortable), not the near-zero runway the legacy 0 column would give.
    expect(row.weeksRemaining).toBe(999);
    expect(row.urgency).toBe("STOCK OK");
  });
});
