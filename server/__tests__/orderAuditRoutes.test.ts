/**
 * Order Audit against the real route table and a real database: a trading
 * day is 06:00–06:00 in the org's timezone and both ends of a range are
 * inclusive (the first version read "Today" as an empty midnight-to-midnight
 * slice and dropped the last day of every range), deleted orders stay on the
 * list, names follow Q14, and the response is never cached.
 *
 * In CI's unit-db job by explicit file name (.github/workflows/ci.yml).
 */
import express from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseOrderAuditQuery } from "../services/orderAudit";

const hasDb = !!process.env.DATABASE_URL;
process.env.DEV_AUTH_BYPASS = "0";

vi.mock("../db", async (importOriginal) =>
  process.env.DATABASE_URL ? await importOriginal() : { db: {}, pool: {} },
);

vi.mock("../auth", async (importOriginal) => {
  const real: Record<string, unknown> = await importOriginal();
  const fakeAuth = (req: any, res: any, next: any) => {
    const role = req.headers["x-test-role"];
    if (!role) return res.status(401).json({ message: "Unauthorized" });
    const id = String(req.headers["x-test-user"]);
    req.user = { id, role, orgId: req.headers["x-test-org"] ?? null, isAllowed: true, claims: { sub: id } };
    return next();
  };
  const fakeOrgContext = (req: any, _res: any, next: any) => {
    if (!req.user) return next();
    req.orgContext = { orgId: req.user.orgId, locationId: null, role: req.user.role };
    return next();
  };
  return { ...real, setupAuth: async () => {}, isAuthenticated: fakeAuth, requireOrgContext: fakeOrgContext };
});

describe("parseOrderAuditQuery", () => {
  it("takes one day as a range of one, and accepts the older parameter names", () => {
    expect(parseOrderAuditQuery({ from: "2030-06-10" })).toEqual({ fromIso: "2030-06-10", toIso: "2030-06-10" });
    expect(parseOrderAuditQuery({ startDate: "2030-06-10", endDate: "2030-06-12" })).toEqual({ fromIso: "2030-06-10", toIso: "2030-06-12" });
  });
  it("refuses backwards, impossible and over-long ranges", () => {
    expect(() => parseOrderAuditQuery({ from: "2030-06-12", to: "2030-06-10" })).toThrow(/on or before/);
    expect(() => parseOrderAuditQuery({ from: "2030-02-30", to: "2030-03-01" })).toThrow(/real days/);
    expect(() => parseOrderAuditQuery({})).toThrow(/real days/);
    expect(() => parseOrderAuditQuery({ from: "2030-01-01", to: "2030-12-31" })).toThrow(/at most 93 days/);
    expect(parseOrderAuditQuery({ from: "2030-01-01", to: "2030-04-03" }).toIso).toBe("2030-04-03"); // exactly 93
  });
});

describe.skipIf(!hasDb)("Order Audit (database)", () => {
  let app: express.Express;
  let db: any;
  let s: typeof import("@shared/schema");
  const orgId = randomUUID();
  const suffix = orgId.slice(0, 8);
  const CASHIER = `audit-cashier-${suffix}`;
  const MANAGER = `audit-manager-${suffix}`;
  const ADMIN = `audit-admin-${suffix}`;
  const ids = { early: "", lateNight: "", nextMorning: "", lastDay: "", deleted: "" };

  const as = (role: string, user: string) => (url: string) =>
    request(app).get(url).set("x-test-role", role).set("x-test-org", orgId).set("x-org-id", orgId).set("x-test-user", user);

  beforeAll(async () => {
    ({ db } = await import("../db"));
    s = await import("@shared/schema");
    await db.insert(s.organizations).values({ id: orgId, name: "ZZ Order Audit Org" });
    await db.insert(s.allowedUsers).values([
      { replitUserId: CASHIER, authUserId: CASHIER, name: "Cara Cashier", role: "CASHIER", orgId },
      { replitUserId: MANAGER, authUserId: MANAGER, name: "Manny Manager", role: "MANAGER", orgId },
      { replitUserId: ADMIN, authUserId: ADMIN, name: "Ada Admin", role: "ADMIN", orgId },
    ]);
    // June: London is UTC+1, so trading day 2030-06-10 runs 05:00Z on the 10th to 05:00Z on the 11th.
    const order = async (createdAt: string, values: Record<string, unknown> = {}) => {
      const [row] = await db
        .insert(s.orders)
        .values({ orgId, total: "10.00", paymentMethod: "cash", status: "completed", createdAt: new Date(createdAt), ...values })
        .returning();
      return row.id as string;
    };
    ids.early = await order("2030-06-10T04:30:00Z"); // 05:30 London: still trading day 06-09
    ids.lateNight = await order("2030-06-10T23:30:00Z", { inputUserId: CASHIER, completedUserId: ADMIN }); // 00:30 on the 11th: trading day 06-10
    ids.nextMorning = await order("2030-06-11T05:30:00Z"); // 06:30 on the 11th: trading day 06-11
    ids.lastDay = await order("2030-06-12T12:00:00Z");
    ids.deleted = randomUUID();
    await db.insert(s.orderEvents).values([
      { orgId, orderId: ids.deleted, kind: "received", userId: CASHIER, at: new Date("2030-06-10T10:00:00Z") },
      {
        orgId,
        orderId: ids.deleted,
        kind: "deleted",
        userId: MANAGER,
        at: new Date("2030-06-10T11:00:00Z"),
        meta: { customerName: "Del Eted", total: "7.50", fulfilmentMethod: "collection", status: "pending" },
      },
    ]);

    const { registerRoutes } = await import("../routes");
    app = express();
    app.use(express.json());
    await registerRoutes(app as any);
  });

  afterAll(async () => {
    if (!db) return;
    const { eq, inArray } = await import("drizzle-orm");
    await db.delete(s.orderEvents).where(eq(s.orderEvents.orgId, orgId)).catch(() => {});
    await db.delete(s.orders).where(eq(s.orders.orgId, orgId)).catch(() => {});
    await db.delete(s.allowedUsers).where(inArray(s.allowedUsers.replitUserId, [CASHIER, MANAGER, ADMIN])).catch(() => {});
    await db.delete(s.organizations).where(eq(s.organizations.id, orgId)).catch(() => {});
  });

  it("reads one day as one trading day, 06:00 to 06:00 local, and is never cached", async () => {
    const res = await as("ADMIN", ADMIN)("/api/reports/order-audit?from=2030-06-10&to=2030-06-10");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toContain("no-store");
    const got = res.body.rows.map((r: any) => r.id);
    expect(got).toContain(ids.lateNight);
    expect(got).toContain(ids.deleted);
    expect(got).not.toContain(ids.early);
    expect(got).not.toContain(ids.nextMorning);
    expect(res.body.truncated).toBe(false);
  });

  it("includes the last day of a range", async () => {
    const res = await as("ADMIN", ADMIN)("/api/reports/order-audit?from=2030-06-11&to=2030-06-12");
    const got = res.body.rows.map((r: any) => r.id);
    expect(got).toEqual(expect.arrayContaining([ids.nextMorning, ids.lastDay]));
  });

  it("keeps a deleted order on the list with who deleted it, and opens its story", async () => {
    const res = await as("ADMIN", ADMIN)("/api/reports/order-audit?from=2030-06-10&to=2030-06-10");
    const row = res.body.rows.find((r: any) => r.id === ids.deleted);
    expect(row).toMatchObject({
      status: "deleted",
      total: 7.5,
      customerName: "Del Eted",
      enteredByName: "Cara Cashier",
      deletedByName: "Manny Manager",
      createdAt: "2030-06-10T10:00:00.000Z",
    });
    const detail = await as("ADMIN", ADMIN)(`/api/reports/order-audit/${ids.deleted}`);
    expect(detail.status).toBe(200);
    expect(detail.body.order).toMatchObject({ status: "deleted", deletedByName: "Manny Manager" });
    expect(detail.body.timeline.map((e: any) => e.kind)).toEqual(["received", "deleted"]);
    expect(detail.body.timeline[0]).not.toHaveProperty("meta");
  });

  it("hides names above a manager's line (Q14) but shows cashiers and themselves", async () => {
    const res = await as("MANAGER", MANAGER)("/api/reports/order-audit?from=2030-06-10&to=2030-06-10");
    const row = res.body.rows.find((r: any) => r.id === ids.lateNight);
    expect(row.enteredByName).toBe("Cara Cashier");
    expect(row.completedByName).toMatch(/hidden/i);
    expect(res.body.rows.find((r: any) => r.id === ids.deleted).deletedByName).toBe("Manny Manager");

    const detail = await as("MANAGER", MANAGER)(`/api/reports/order-audit/${ids.lateNight}`);
    expect(detail.body.order.completedByName).toMatch(/hidden/i);
    expect(JSON.stringify(detail.body)).not.toContain("Ada Admin");
  });

  it("refuses cashiers, bad ranges and other orgs' orders", async () => {
    expect((await as("CASHIER", CASHIER)("/api/reports/order-audit?from=2030-06-10")).status).toBe(403);
    expect((await as("ADMIN", ADMIN)("/api/reports/order-audit?from=2030-06-12&to=2030-06-10")).status).toBe(400);
    const elsewhere = await request(app)
      .get(`/api/reports/order-audit/${ids.lateNight}`)
      .set("x-test-role", "ADMIN")
      .set("x-test-org", randomUUID())
      .set("x-test-user", ADMIN);
    expect(elsewhere.status).toBe(404);
  });
  it("lists a deleted order on the day it was taken, not the day it was deleted", async () => {
    const late = randomUUID();
    await db.insert(s.orderEvents).values({
      orgId,
      orderId: late,
      kind: "deleted",
      userId: MANAGER,
      at: new Date("2030-06-11T10:00:00Z"), // trading day 06-11
      meta: { customerName: "Late Delete", total: "3.00", createdAt: "2030-06-10T14:00:00.000Z", inputUserId: CASHIER },
    });
    const dayTaken = await as("ADMIN", ADMIN)("/api/reports/order-audit?from=2030-06-10&to=2030-06-10");
    const row = dayTaken.body.rows.find((r: any) => r.id === late);
    expect(row).toMatchObject({ status: "deleted", createdAt: "2030-06-10T14:00:00.000Z", enteredByName: "Cara Cashier", deletedByName: "Manny Manager" });
    const dayDeleted = await as("ADMIN", ADMIN)("/api/reports/order-audit?from=2030-06-11&to=2030-06-11");
    expect(dayDeleted.body.rows.map((r: any) => r.id)).not.toContain(late);
  });
});
