import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { locations, organizations, shifts } from "@shared/schema";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("requireOpenShift", () => {
  let db: (typeof import("../db"))["db"];
  let app: express.Express;
  let orgId: string;
  let locationId: string;
  let userId: string;

  beforeEach(async () => {
    ({ db } = await import("../db"));
    const { requireOpenShift } = await import("../middleware/requireOpenShift");

    orgId = randomUUID();
    locationId = randomUUID();
    userId = `shift-user-${randomUUID()}`;

    await db.insert(organizations).values({ id: orgId, name: "Open Shift Test" });
    await db.insert(locations).values({
      id: locationId,
      orgId,
      name: "Counter",
      address: "1 Test Street",
      city: "Testville",
      state: "Test",
      zipCode: "T1",
      phone: "000",
      email: "counter@example.test",
      isDefault: 1,
    });

    const scoped: RequestHandler = (req: any, _res, next) => {
      req.orgContext = { orgId, locationId, role: "CASHIER" };
      req.user = { id: userId };
      next();
    };

    app = express();
    app.use(express.json());
    app.post("/checkout", scoped, requireOpenShift, (req: any, res) => {
      res.json({ shiftId: req.shift.id, locationId: req.shift.locationId });
    });
  });

  afterEach(async () => {
    await db.delete(shifts).where(eq(shifts.orgId, orgId));
    await db.delete(locations).where(eq(locations.id, locationId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("reuses a reopened till shift instead of opening a second drawer", async () => {
    const [reopened] = await db
      .insert(shifts)
      .values({
        orgId,
        locationId,
        userId,
        openingFloat: "20.00",
        status: "reopened",
      })
      .returning();

    const res = await request(app).post("/checkout").send({}).expect(200);
    expect(res.body).toMatchObject({ shiftId: reopened.id, locationId });

    const active = await db
      .select()
      .from(shifts)
      .where(
        and(
          eq(shifts.orgId, orgId),
          eq(shifts.locationId, locationId),
          eq(shifts.userId, userId),
          inArray(shifts.status, ["open", "reopened"]),
        ),
      );
    expect(active.map((shift) => shift.id)).toEqual([reopened.id]);
  });
});
