/**
 * ARC-026: no report read `ctx.locationId`/a `cashierId` at all — every report
 * was always computed org-wide, with no way to scope to one location or one
 * cashier. This asserts, against a real DB and the real Express route:
 *  - GET /api/reports/:ref?locationId= 404s when the id does not belong to
 *    the caller's org (a foreign id, or a cashier id for a different org),
 *    rather than silently falling back to org-wide data; and
 *  - Daily Sales revenue and Current Stock levels actually narrow to the
 *    given location/cashier rather than the id being accepted but ignored.
 */
import express from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  locations,
  organizations,
  orders,
  products,
  productLocationStock,
  cashierProfiles,
} from "@shared/schema";

const hasDb = !!process.env.DATABASE_URL;

function makeLocation(id: string, orgId: string, name: string, isDefault: 0 | 1) {
  return {
    id,
    orgId,
    name,
    address: "1 Test Street",
    city: "Testville",
    state: "Test",
    zipCode: "T1",
    phone: "000",
    email: `${id}@example.test`,
    isDefault,
    isActive: 1,
  };
}

describe.skipIf(!hasDb)("ARC-026: report location/cashier scope", () => {
  let db: (typeof import("../db"))["db"];
  let app: express.Express;
  let orgId: string;
  let otherOrgId: string;
  let locationA: string;
  let locationB: string;
  let foreignLocationId: string;
  let cashierA: string;
  let cashierB: string;
  let foreignCashierId: string;

  beforeEach(async () => {
    ({ db } = await import("../db"));
    const { registerReportRoutes } = await import("../routes/reports");

    orgId = randomUUID();
    otherOrgId = randomUUID();
    locationA = randomUUID();
    locationB = randomUUID();
    foreignLocationId = randomUUID();
    cashierA = randomUUID();
    cashierB = randomUUID();
    foreignCashierId = randomUUID();

    await db.insert(organizations).values([
      { id: orgId, name: "Report Scope Org" },
      { id: otherOrgId, name: "Other Org" },
    ]);
    await db.insert(locations).values([
      makeLocation(locationA, orgId, "Location A", 1),
      makeLocation(locationB, orgId, "Location B", 0),
      makeLocation(foreignLocationId, otherOrgId, "Foreign Location", 1),
    ]);
    await db.insert(cashierProfiles).values([
      { id: cashierA, orgId, cashierCode: "CA1", displayName: "Cashier A" },
      { id: cashierB, orgId, cashierCode: "CB1", displayName: "Cashier B" },
      { id: foreignCashierId, orgId: otherOrgId, cashierCode: "FC1", displayName: "Foreign Cashier" },
    ]);

    // Same trading day (Europe/London default, GMT in January), split across
    // two locations and two cashiers so a scoped query must actually narrow.
    await db.insert(orders).values([
      {
        id: randomUUID(),
        orgId,
        locationId: locationA,
        completedCashierId: cashierA,
        total: "100.00",
        paymentMethod: "cash",
        status: "completed",
        settledTotal: "100.00",
        settledAt: new Date("2026-01-15T10:00:00.000Z"),
      },
      {
        id: randomUUID(),
        orgId,
        locationId: locationB,
        completedCashierId: cashierB,
        total: "40.00",
        paymentMethod: "cash",
        status: "completed",
        settledTotal: "40.00",
        settledAt: new Date("2026-01-15T11:00:00.000Z"),
      },
    ] as never);

    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.orgContext = { orgId, locationId: null, role: "MANAGER" };
      next();
    });
    registerReportRoutes(app, []);
  });

  afterEach(async () => {
    await db.delete(orders).where(eq(orders.orgId, orgId));
    await db.delete(cashierProfiles).where(inArray(cashierProfiles.orgId, [orgId, otherOrgId]));
    await db.delete(productLocationStock).where(inArray(productLocationStock.orgId, [orgId, otherOrgId]));
    await db.delete(products).where(inArray(products.orgId, [orgId, otherOrgId]));
    await db.delete(locations).where(inArray(locations.orgId, [orgId, otherOrgId]));
    await db.delete(organizations).where(inArray(organizations.id, [orgId, otherOrgId]));
  });

  it("404s a locationId that belongs to a different org, rather than falling back to org-wide", async () => {
    const res = await request(app).get(
      `/api/reports/ARC-T1-001?from=2026-01-15&to=2026-01-15&locationId=${foreignLocationId}`,
    );
    expect(res.status).toBe(404);
  });

  it("404s a cashierId that belongs to a different org", async () => {
    const res = await request(app).get(
      `/api/reports/ARC-T1-001?from=2026-01-15&to=2026-01-15&cashierId=${foreignCashierId}`,
    );
    expect(res.status).toBe(404);
  });

  it("404s a locationId that does not exist at all", async () => {
    const res = await request(app).get(
      `/api/reports/ARC-T1-001?from=2026-01-15&to=2026-01-15&locationId=${randomUUID()}`,
    );
    expect(res.status).toBe(404);
  });

  it("404s (not 500) a syntactically malformed locationId", async () => {
    // Postgres throws 22P02 invalid_text_representation comparing a `uuid`
    // column against a non-UUID string — validateReportScope must catch this
    // before it reaches the DB, or a typo'd query param 500s instead of 404s.
    const res = await request(app).get(
      `/api/reports/ARC-T1-001?from=2026-01-15&to=2026-01-15&locationId=not-a-real-uuid`,
    );
    expect(res.status).toBe(404);
  });

  it("scopes Daily Sales revenue to the given location", async () => {
    const resA = await request(app)
      .get(`/api/reports/ARC-T1-001?from=2026-01-15&to=2026-01-15&locationId=${locationA}`)
      .expect(200);
    expect(resA.body.summary.totalRevenue).toBe(100);

    const resB = await request(app)
      .get(`/api/reports/ARC-T1-001?from=2026-01-15&to=2026-01-15&locationId=${locationB}`)
      .expect(200);
    expect(resB.body.summary.totalRevenue).toBe(40);

    const resAll = await request(app)
      .get(`/api/reports/ARC-T1-001?from=2026-01-15&to=2026-01-15`)
      .expect(200);
    expect(resAll.body.summary.totalRevenue).toBe(140);
  });

  it("scopes Daily Sales revenue to the given cashier", async () => {
    const resA = await request(app)
      .get(`/api/reports/ARC-T1-001?from=2026-01-15&to=2026-01-15&cashierId=${cashierA}`)
      .expect(200);
    expect(resA.body.summary.totalRevenue).toBe(100);
    expect(resA.body.summary.ordersProcessed).toBe(1);
  });

  it("scopes Current Stock Levels to the given location", async () => {
    const productId = randomUUID();
    await db.insert(products).values({
      id: productId,
      orgId,
      name: "Scoped Widget",
      productId: `SW-${productId}`,
      defaultSalePrice: "5.00",
      stock: 0,
      stockLimit: 5,
    } as never);
    await db.insert(productLocationStock).values([
      { orgId, productId, locationId: locationA, stock: 12, stockLimit: 5 },
      { orgId, productId, locationId: locationB, stock: 3, stockLimit: 5 },
    ] as never);

    const resA = await request(app)
      .get(`/api/reports/ARC-T1-002?locationId=${locationA}`)
      .expect(200);
    const rowA = resA.body.rows.find((r: any) => r.product === "Scoped Widget");
    expect(rowA.unitsInStock).toBe(12);

    const resB = await request(app)
      .get(`/api/reports/ARC-T1-002?locationId=${locationB}`)
      .expect(200);
    const rowB = resB.body.rows.find((r: any) => r.product === "Scoped Widget");
    expect(rowB.unitsInStock).toBe(3);
  });
});
