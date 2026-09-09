import express from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { locations, organizations } from "@shared/schema";

const hasDb = !!process.env.DATABASE_URL;

/**
 * Regression coverage for ARC-001: a cashier with no X-Location-Id header, no
 * personal default location, and no open till shift used to leave
 * orgContext.locationId null even when the org has a default active
 * location — which then 400'd every sale with "Location required for POS"
 * despite the org being fully configured. requireOrgContext must fall
 * through to that org default as a last resort.
 */
describe.skipIf(!hasDb)("requireOrgContext location fallback", () => {
  let db: (typeof import("../db"))["db"];
  let app: express.Express;
  let orgId: string;
  let locationId: string;
  const userId = `org-context-user-${randomUUID()}`;

  beforeEach(async () => {
    ({ db } = await import("../db"));
    const { requireOrgContext } = await import("../auth/commonAuth");

    orgId = randomUUID();
    locationId = randomUUID();

    await db.insert(organizations).values({ id: orgId, name: "Org Context Test" });
    await db.insert(locations).values({
      id: locationId,
      orgId,
      name: "Main Counter",
      address: "1 Test Street",
      city: "Testville",
      state: "Test",
      zipCode: "T1",
      phone: "000",
      email: "counter@example.test",
      isDefault: 1,
      isActive: 1,
    });

    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      // No defaultLocationId, no X-Location-Id header, no open shift for
      // this user — every prior fallback in requireOrgContext is empty.
      req.user = { id: userId, role: "CASHIER", orgId };
      next();
    });
    app.use(requireOrgContext);
    app.get("/context", (req: any, res) => res.json(req.orgContext));
  });

  afterEach(async () => {
    await db.delete(locations).where(eq(locations.id, locationId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("resolves the org's default active location when nothing else does", async () => {
    const res = await request(app).get("/context").expect(200);
    expect(res.body).toMatchObject({ orgId, locationId, role: "CASHIER" });
  });
});
