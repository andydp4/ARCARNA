/**
 * ARC-026: no report read `ctx.locationId` or a person at all — every report
 * was always computed org-wide, with no way to scope to one location or one
 * member of staff. This asserts, against a real DB and the real Express route:
 *  - GET /api/reports/:ref?locationId= / ?staffId= 404s when the id does not
 *    belong to the caller's org, rather than silently falling back to
 *    org-wide data; and
 *  - Daily Sales revenue and Current Stock levels actually narrow to the
 *    given location/person rather than the id being accepted but ignored.
 *
 * STF-FN2: the staff filter is keyed on who completed the order
 * (`completed_user_id`), not a cashier code. Orders since the lazy-shift
 * change have `completed_cashier_id` NULL, and the old code-keyed filter
 * answered £0 for them. An old `?cashierId=` link is refused, not answered
 * org-wide.
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
  allowedUsers,
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

describe.skipIf(!hasDb)("ARC-026: report location/staff scope", () => {
  let db: (typeof import("../db"))["db"];
  let app: express.Express;
  let orgId: string;
  let otherOrgId: string;
  let locationA: string;
  let locationB: string;
  let foreignLocationId: string;
  let staffA: string;
  let staffB: string;
  let foreignStaffId: string;
  // Admin by default: an admin may filter by anyone. The manager's narrower
  // view (Q12) has its own test below.
  let viewer = { id: "report-scope-admin", role: "ADMIN" };

  beforeEach(async () => {
    viewer = { id: "report-scope-admin", role: "ADMIN" };
    ({ db } = await import("../db"));
    const { registerReportRoutes } = await import("../routes/reports");

    orgId = randomUUID();
    otherOrgId = randomUUID();
    locationA = randomUUID();
    locationB = randomUUID();
    foreignLocationId = randomUUID();
    // Auth subjects, deliberately not UUIDs: that is what real user ids are.
    staffA = `user_scopeA_${randomUUID().slice(0, 8)}`;
    staffB = `user_scopeB_${randomUUID().slice(0, 8)}`;
    foreignStaffId = `user_scopeF_${randomUUID().slice(0, 8)}`;

    await db.insert(organizations).values([
      { id: orgId, name: "Report Scope Org" },
      { id: otherOrgId, name: "Other Org" },
    ]);
    await db.insert(locations).values([
      makeLocation(locationA, orgId, "Location A", 1),
      makeLocation(locationB, orgId, "Location B", 0),
      makeLocation(foreignLocationId, otherOrgId, "Foreign Location", 1),
    ]);
    await db.insert(allowedUsers).values([
      { replitUserId: staffA, authUserId: staffA, name: "Staff A", role: "CASHIER", orgId },
      { replitUserId: staffB, authUserId: staffB, name: "Staff B", role: "MANAGER", orgId },
      { replitUserId: foreignStaffId, authUserId: foreignStaffId, name: "Foreign", role: "CASHIER", orgId: otherOrgId },
    ] as never);

    // Same trading day (Europe/London default, GMT in January), split across
    // two locations and two people so a scoped query must actually narrow.
    // Today's shape: the person is on completed_user_id and there is no
    // cashier code at all.
    await db.insert(orders).values([
      {
        id: randomUUID(),
        orgId,
        locationId: locationA,
        completedUserId: staffA,
        completedCashierId: null,
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
        completedUserId: staffB,
        completedCashierId: null,
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
      req.orgContext = { orgId, locationId: null, role: viewer.role };
      req.user = { id: viewer.id, role: viewer.role };
      next();
    });
    registerReportRoutes(app, []);
  });

  afterEach(async () => {
    await db.delete(orders).where(eq(orders.orgId, orgId));
    await db.delete(allowedUsers).where(inArray(allowedUsers.replitUserId, [staffA, staffB, foreignStaffId]));
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

  it("404s a staffId that belongs to a different org", async () => {
    const res = await request(app).get(
      `/api/reports/ARC-T1-001?from=2026-01-15&to=2026-01-15&staffId=${foreignStaffId}`,
    );
    expect(res.status).toBe(404);
  });

  it("refuses an old cashier-code link rather than answering org-wide under one person's name", async () => {
    const res = await request(app).get(
      `/api/reports/ARC-T1-001?from=2026-01-15&to=2026-01-15&cashierId=${randomUUID()}`,
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

  it("scopes Daily Sales to whoever completed the order, with no cashier code involved", async () => {
    const resA = await request(app)
      .get(`/api/reports/ARC-T1-001?from=2026-01-15&to=2026-01-15&staffId=${staffA}`)
      .expect(200);
    expect(resA.body.summary.totalRevenue).toBe(100);
    expect(resA.body.summary.ordersProcessed).toBe(1);

    const resB = await request(app)
      .get(`/api/reports/ARC-T1-001?from=2026-01-15&to=2026-01-15&staffId=${staffB}`)
      .expect(200);
    expect(resB.body.summary.totalRevenue).toBe(40);
  });

  it("a manager filters by cashiers and themself, never by a peer manager or above (Q12)", async () => {
    viewer = { id: "report-scope-manager", role: "MANAGER" };
    const picker = await request(app).get("/api/evidence/staff").expect(200);
    expect(picker.body.map((m: { id: string }) => m.id)).toEqual([staffA]);

    await request(app)
      .get(`/api/reports/ARC-T1-001?from=2026-01-15&to=2026-01-15&staffId=${staffA}`)
      .expect(200);
    for (const ref of ["ARC-T1-001", "ARC-T1-004", "ARC-T2-001"]) {
      await request(app).get(`/api/reports/${ref}?from=2026-01-12&to=2026-01-18&staffId=${staffB}`).expect(403);
    }

    // Their own sales are theirs to see.
    viewer = { id: staffB, role: "MANAGER" };
    const own = await request(app)
      .get(`/api/reports/ARC-T1-001?from=2026-01-15&to=2026-01-15&staffId=${staffB}`)
      .expect(200);
    expect(own.body.summary.totalRevenue).toBe(40);
    const ownPicker = await request(app).get("/api/evidence/staff").expect(200);
    expect(ownPicker.body.map((m: { id: string }) => m.id).sort()).toEqual([staffA, staffB].sort());

    viewer = { id: "report-scope-admin", role: "ADMIN" };
    const adminPicker = await request(app).get("/api/evidence/staff").expect(200);
    expect(adminPicker.body.map((m: { id: string }) => m.id).sort()).toEqual([staffA, staffB].sort());
  });

  it("scopes Weekly Sales and Weekly Margin the same way", async () => {
    const weekly = await request(app)
      .get(`/api/reports/ARC-T1-004?from=2026-01-12&to=2026-01-18&staffId=${staffB}`)
      .expect(200);
    expect(weekly.body.summary.totalRevenue).toBe(40);
    expect(weekly.body.summary.totalOrders).toBe(1);

    const margin = await request(app)
      .get(`/api/reports/ARC-T2-001?from=2026-01-12&to=2026-01-18&staffId=${staffA}`)
      .expect(200);
    // No order items were seeded, so nothing to cost: proves it ran scoped
    // rather than 404ing on a non-UUID id.
    expect(margin.body.summary.products).toBe(0);
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
