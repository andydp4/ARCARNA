import express from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { locations, organizations, shifts } from "@shared/schema";
import { db } from "../db";
import { requireOpenShift } from "../middleware/requireOpenShift";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("opening POS till shifts lazily", () => {
  let app: express.Express;
  let orgId: string;
  let locationId: string;
  let userId: string;

  beforeEach(async () => {
    orgId = randomUUID();
    locationId = randomUUID();
    userId = `shift-race-${Date.now()}`;

    await db.insert(organizations).values({ id: orgId, name: "Open Shift Race Test" });
    await db.insert(locations).values({
      id: locationId,
      orgId,
      name: "Race Location",
      address: "1 Test Street",
      city: "Testville",
      state: "Test",
      zipCode: "T1",
      phone: "000",
      email: "race@example.test",
      isDefault: 1,
    });

    app = express();
    app.use(express.json());
    app.post(
      "/checkout",
      (req: any, _res, next) => {
        req.orgContext = { orgId, locationId, role: "CASHIER" };
        req.user = { id: userId, role: "CASHIER" };
        next();
      },
      requireOpenShift,
      (req: any, res) => res.json({ shift: req.shift }),
    );
  });

  afterEach(async () => {
    await db.delete(shifts).where(eq(shifts.orgId, orgId));
    await db.delete(locations).where(eq(locations.orgId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("returns the same open shift when first sales race", async () => {
    const responses = await Promise.all(
      Array.from({ length: 12 }, () => request(app).post("/checkout").send({}).expect(200)),
    );

    const ids = new Set(responses.map((response) => response.body.shift.id));
    expect(ids.size).toBe(1);

    const openShifts = await db
      .select()
      .from(shifts)
      .where(
        and(
          eq(shifts.orgId, orgId),
          eq(shifts.locationId, locationId),
          eq(shifts.userId, userId),
          eq(shifts.status, "open"),
        ),
      );
    expect(openShifts).toHaveLength(1);
  });
});
