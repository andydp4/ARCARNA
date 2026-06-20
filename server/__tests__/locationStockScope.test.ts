import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import {
  locations,
  organizations,
  productLocationStock,
  products,
} from "@shared/schema";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("location-scoped product stock", () => {
  let orgId: string;
  let locationAId: string;
  let locationBId: string;
  let localProductId: string;
  let remoteOnlyProductId: string;
  let db: (typeof import("../db"))["db"];
  let storage: (typeof import("../storage"))["storage"];
  let ProductsRepoDrizzle: (typeof import("../../apps/server/src/db/repos"))["ProductsRepoDrizzle"];

  beforeEach(async () => {
    ({ db } = await import("../db"));
    ({ storage } = await import("../storage"));
    ({ ProductsRepoDrizzle } = await import("../../apps/server/src/db/repos"));

    orgId = randomUUID();
    locationAId = randomUUID();
    locationBId = randomUUID();
    localProductId = randomUUID();
    remoteOnlyProductId = randomUUID();

    await db.insert(organizations).values({
      id: orgId,
      name: "Location Stock Scope Test",
    });

    await db.insert(locations).values([
      {
        id: locationAId,
        orgId,
        name: "Location A",
        address: "1 Test Street",
        city: "Testville",
        state: "Test",
        zipCode: "T1",
        phone: "000",
        email: "a@example.test",
        isDefault: 1,
      },
      {
        id: locationBId,
        orgId,
        name: "Location B",
        address: "2 Test Street",
        city: "Testville",
        state: "Test",
        zipCode: "T2",
        phone: "000",
        email: "b@example.test",
      },
    ]);

    await db.insert(products).values([
      {
        id: localProductId,
        orgId,
        name: "Local and Remote Widget",
        productId: `LOCAL-${localProductId}`,
        locationId: locationAId,
        defaultSalePrice: "10.00",
        stock: 0,
      },
      {
        id: remoteOnlyProductId,
        orgId,
        name: "Remote Only Widget",
        productId: `REMOTE-${remoteOnlyProductId}`,
        locationId: locationBId,
        defaultSalePrice: "10.00",
        stock: 0,
      },
    ]);

    await db.insert(productLocationStock).values([
      {
        orgId,
        productId: localProductId,
        locationId: locationAId,
        stock: 2,
        stockLimit: 10,
      },
      {
        orgId,
        productId: localProductId,
        locationId: locationBId,
        stock: 100,
        stockLimit: 10,
      },
      {
        orgId,
        productId: remoteOnlyProductId,
        locationId: locationBId,
        stock: 50,
        stockLimit: 10,
      },
    ]);
  });

  afterEach(async () => {
    await db
      .delete(productLocationStock)
      .where(eq(productLocationStock.orgId, orgId));
    await db
      .delete(products)
      .where(inArray(products.id, [localProductId, remoteOnlyProductId]));
    await db
      .delete(locations)
      .where(inArray(locations.id, [locationAId, locationBId]));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("reports active-location stock instead of org-wide totals", async () => {
    const locationAProducts = await storage.getProductsWithStock(orgId, locationAId);
    const orgWideProducts = await storage.getProductsWithStock(orgId);

    expect(locationAProducts.find((p) => p.id === localProductId)?.stock).toBe(2);
    expect(locationAProducts.find((p) => p.id === remoteOnlyProductId)?.stock).toBe(0);
    expect(orgWideProducts.find((p) => p.id === localProductId)?.stock).toBe(102);
    expect(orgWideProducts.find((p) => p.id === remoteOnlyProductId)?.stock).toBe(50);
  });

  it("does not accept stock from another location when checking an order", async () => {
    await expect(
      ProductsRepoDrizzle.checkStock(remoteOnlyProductId as any, {
        orgId,
        locationId: locationAId,
      }),
    ).resolves.toBe(0);

    await expect(
      ProductsRepoDrizzle.checkStock(localProductId as any, {
        orgId,
        locationId: locationAId,
      }),
    ).resolves.toBe(2);
  });
});
