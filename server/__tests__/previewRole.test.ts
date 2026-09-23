/**
 * "Preview as role" (CMP-09) through real routes and a real database: an
 * admin (or the owner, whose login has no fixed org) previewing a cashier gets
 * exactly what a cashier gets from the server — cost stripped, manager-only
 * reads refused — and cannot write anything. Anyone below admin is refused.
 * In CI's unit-db job by explicit file name.
 */
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("preview as role", () => {
  let db: (typeof import("../db"))["db"];
  let schema: typeof import("@shared/schema");
  let app: express.Express;
  const orgId = randomUUID();
  // Who is really signed in for the next request.
  let signedIn: Record<string, unknown> = {};
  let sessionUserSeen: Record<string, unknown> | null = null;

  beforeAll(async () => {
    process.env.DEV_AUTH_BYPASS = "0";
    ({ db } = await import("../db"));
    schema = await import("@shared/schema");
    await db.insert(schema.organizations).values({ id: orgId, name: "ZZ Preview Role Test" });
    await db.insert(schema.products).values({
      orgId,
      name: "Canary Widget",
      productId: `PRV-${randomUUID().slice(0, 8)}`,
      defaultSalePrice: "20.00",
      costPrice: "13.37",
      stock: 3,
    });

    const { applyPreviewRole } = await import("../auth/previewRole");
    const { requireOrgContext, requireOrgScope } = await import("../auth/commonAuth");
    const fakeSignIn: RequestHandler = (req: any, _res, next) => {
      // Stand-in for the session's user object: must come out unmodified.
      sessionUserSeen = { ...signedIn };
      req.user = sessionUserSeen;
      next();
    };
    const preview: RequestHandler = (req, res, next) => void applyPreviewRole(req, res, next);
    const scoped = [fakeSignIn, preview, requireOrgContext, requireOrgScope];
    const { registerProductRoutes } = await import("../routes/products");
    const { registerCustomerRoutes } = await import("../routes/customers");
    app = express();
    app.use(express.json());
    registerProductRoutes(app, scoped);
    registerCustomerRoutes(app, scoped);
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.products).where(eq(schema.products.orgId, orgId));
    await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId));
  });

  const admin = () => ({ id: "prv-admin", role: "ADMIN", orgId, claims: { sub: "prv-admin" } });
  const owner = () => ({ id: "prv-owner", role: "SUPER_ADMIN", isOwner: true, orgId: null, claims: { sub: "prv-owner" } });

  it("without the header an admin sees cost as usual", async () => {
    signedIn = admin();
    const res = await request(app).get("/api/products").expect(200);
    expect(JSON.stringify(res.body)).toContain("13.37");
  });

  it("an admin previewing a cashier gets the cashier's data: no cost", async () => {
    signedIn = admin();
    const res = await request(app).get("/api/products").set("X-Preview-Role", "CASHIER").expect(200);
    expect(res.headers["x-preview-role"]).toBe("CASHIER");
    expect(res.body.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).not.toContain("13.37");
    // The session's own user object keeps the real role.
    expect(sessionUserSeen?.role).toBe("ADMIN");
    expect(sessionUserSeen?.preview).toBeUndefined();
  });

  it("the owner (no fixed org) previews the org they picked", async () => {
    signedIn = owner();
    const res = await request(app)
      .get("/api/products")
      .set("X-Preview-Role", "CASHIER")
      .set("X-Org-Id", orgId)
      .expect(200);
    expect(res.body.some((p: { name: string }) => p.name === "Canary Widget")).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain("13.37");
  });

  it("manager-only reads are refused to a previewed cashier, allowed to a previewed manager", async () => {
    signedIn = admin();
    await request(app).get("/api/customers/intelligence").set("X-Preview-Role", "CASHIER").expect(403);
    const asManager = await request(app).get("/api/customers/intelligence").set("X-Preview-Role", "MANAGER");
    expect(asManager.status).not.toBe(403);
  });

  it("is read-only: writes are refused before any route runs", async () => {
    signedIn = admin();
    const res = await request(app)
      .post("/api/products")
      .set("X-Preview-Role", "MANAGER")
      .send({ name: "Should not exist", defaultSalePrice: "1.00" })
      .expect(403);
    expect(res.body.code).toBe("PREVIEW_READ_ONLY");
    const rows = await db.select().from(schema.products).where(eq(schema.products.name, "Should not exist"));
    expect(rows).toHaveLength(0);
  });

  it("a manager or cashier cannot use it, and only lower roles can be previewed", async () => {
    signedIn = { id: "prv-mgr", role: "MANAGER", orgId, claims: { sub: "prv-mgr" } };
    expect((await request(app).get("/api/products").set("X-Preview-Role", "CASHIER").expect(403)).body.code).toBe(
      "PREVIEW_NOT_ALLOWED",
    );
    signedIn = admin();
    expect((await request(app).get("/api/products").set("X-Preview-Role", "SUPER_ADMIN").expect(400)).body.code).toBe(
      "PREVIEW_ROLE_INVALID",
    );
  });

  it("the board stream's ?previewRole= works for GETs only", async () => {
    signedIn = admin();
    const res = await request(app).get("/api/products?previewRole=CASHIER").expect(200);
    expect(JSON.stringify(res.body)).not.toContain("13.37");
  });
});
