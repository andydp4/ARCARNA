/**
 * Settings → Labels against the real route table and a real database: every
 * member of staff reads the shop's label settings (every till prints with
 * them), only a manager and above change them, a change merges into what is
 * stored, and anything but the known switches is refused.
 *
 * In CI's unit-db job by explicit file name (.github/workflows/ci.yml).
 */
import express from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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

describe.skipIf(!hasDb)("Label settings (database)", () => {
  let app: express.Express;
  let db: any;
  let s: typeof import("@shared/schema");
  const orgId = randomUUID();
  const suffix = orgId.slice(0, 8);
  const CASHIER = `labels-cashier-${suffix}`;
  const MANAGER = `labels-manager-${suffix}`;

  const as = (role: string, user: string) => ({
    get: (url: string) => request(app).get(url).set("x-test-role", role).set("x-test-org", orgId).set("x-org-id", orgId).set("x-test-user", user),
    put: (url: string, body: unknown) =>
      request(app).put(url).set("x-test-role", role).set("x-test-org", orgId).set("x-org-id", orgId).set("x-test-user", user).send(body as object),
  });

  beforeAll(async () => {
    ({ db } = await import("../db"));
    s = await import("@shared/schema");
    await db.insert(s.organizations).values({ id: orgId, name: "ZZ Label Settings Org" });
    await db.insert(s.allowedUsers).values([
      { replitUserId: CASHIER, authUserId: CASHIER, name: "Cal Cashier", role: "CASHIER", orgId },
      { replitUserId: MANAGER, authUserId: MANAGER, name: "Mia Manager", role: "MANAGER", orgId },
    ]);
    const { registerRoutes } = await import("../routes");
    app = express();
    app.use(express.json());
    await registerRoutes(app as any);
  });

  afterAll(async () => {
    if (!db) return;
    const { eq, inArray } = await import("drizzle-orm");
    await db.delete(s.adminAuditLogs).where(eq(s.adminAuditLogs.orgId, orgId)).catch(() => {});
    await db.delete(s.allowedUsers).where(inArray(s.allowedUsers.replitUserId, [CASHIER, MANAGER])).catch(() => {});
    await db.delete(s.organizations).where(eq(s.organizations.id, orgId)).catch(() => {});
  });

  it("gives every member of staff the defaults until someone changes them", async () => {
    const res = await as("CASHIER", CASHIER).get("/api/labels/settings");
    expect(res.status).toBe(200);
    const { DEFAULT_LABEL_SETTINGS } = await import("@shared/labelSettings");
    expect(res.body).toEqual(DEFAULT_LABEL_SETTINGS);
  });

  it("lets a manager change them, merging into what is stored, and every till then reads the change", async () => {
    const first = await as("MANAGER", MANAGER).put("/api/labels/settings", { order: { qr: false }, printSet: { packaging: false } });
    expect(first.status).toBe(200);
    const second = await as("MANAGER", MANAGER).put("/api/labels/settings", { autoPrintAfterPayment: true });
    expect(second.status).toBe(200);
    const read = await as("CASHIER", CASHIER).get("/api/labels/settings");
    expect(read.body.order.qr).toBe(false);
    expect(read.body.order.customerName).toBe(true);
    expect(read.body.printSet.packaging).toBe(false);
    expect(read.body.autoPrintAfterPayment).toBe(true);
  });

  it("refuses a cashier, and anything but the known switches", async () => {
    expect((await as("CASHIER", CASHIER).put("/api/labels/settings", { autoPrintAfterPayment: false })).status).toBe(403);
    expect((await as("MANAGER", MANAGER).put("/api/labels/settings", { order: { phone: true } })).status).toBe(400);
    expect((await as("MANAGER", MANAGER).put("/api/labels/settings", { printSet: { order: "yes" } })).status).toBe(400);
  });
});
