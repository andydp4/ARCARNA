/**
 * GET /api/admin/allowed-users lists an org's staff logins: emails, roles,
 * commission rates, default locations. Only the owner may name which org
 * through X-Org-Id / ?orgId=; an admin is pinned to their own, or an org A
 * admin could list org B's staff and pay.
 *
 * In CI's unit-db job by explicit file name (.github/workflows/ci.yml).
 */
import express from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { inArray } from "drizzle-orm";

const hasDb = !!process.env.DATABASE_URL;
process.env.DEV_AUTH_BYPASS = "0";

vi.mock("../auth", async (importOriginal) => {
  const real: Record<string, unknown> = await importOriginal();
  const fakeAuth = (req: any, res: any, next: any) => {
    const id = req.headers["x-test-user"];
    const role = req.headers["x-test-role"];
    if (!id || !role) return res.status(401).json({ message: "Unauthorized" });
    req.user = { id, role, claims: { sub: id }, isAllowed: true };
    return next();
  };
  return { ...real, isAuthenticated: fakeAuth };
});

describe.skipIf(!hasDb)("GET /api/admin/allowed-users: org scope", () => {
  let db: (typeof import("../db"))["db"];
  let schema: typeof import("@shared/schema");
  let app: express.Express;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const tag = randomUUID().slice(0, 8);
  const adminA = `au-admin-a-${tag}`;
  const staffB = `au-staff-b-${tag}`;
  const owner = `au-owner-${tag}`;

  beforeAll(async () => {
    ({ db } = await import("../db"));
    schema = await import("@shared/schema");
    await db.insert(schema.organizations).values([
      { id: orgA, name: "ZZ Allowed Users A" },
      { id: orgB, name: "ZZ Allowed Users B" },
    ]);
    await db.insert(schema.allowedUsers).values([
      { replitUserId: adminA, authUserId: adminA, email: `a-${tag}@example.invalid`, name: "Admin A", role: "ADMIN", orgId: orgA },
      { replitUserId: staffB, authUserId: staffB, email: `b-${tag}@example.invalid`, name: "Staff B", role: "CASHIER", orgId: orgB },
      { replitUserId: owner, authUserId: owner, email: `o-${tag}@example.invalid`, name: "Owner", role: "SUPER_ADMIN", orgId: null },
    ] as never);
    const { registerAdminRoutes } = await import("../routes/admin");
    app = express();
    app.use(express.json());
    registerAdminRoutes(app);
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.allowedUsers).where(inArray(schema.allowedUsers.replitUserId, [adminA, staffB, owner]));
    await db.delete(schema.organizations).where(inArray(schema.organizations.id, [orgA, orgB]));
  });

  const list = (user: string, role: string) =>
    request(app).get("/api/admin/allowed-users").set("x-test-user", user).set("x-test-role", role);

  it("an admin sees their own org's staff", async () => {
    const res = await list(adminA, "ADMIN").expect(200);
    const ids = res.body.map((r: any) => r.replitUserId);
    expect(ids).toContain(adminA);
    expect(ids).not.toContain(staffB);
    // Naming their own org is fine.
    await list(adminA, "ADMIN").set("x-org-id", orgA).expect(200);
  });

  it("an admin cannot name another org by header or query", async () => {
    const byHeader = await list(adminA, "ADMIN").set("x-org-id", orgB).expect(403);
    expect(JSON.stringify(byHeader.body)).not.toContain(`b-${tag}@example.invalid`);
    await request(app)
      .get(`/api/admin/allowed-users?orgId=${orgB}`)
      .set("x-test-user", adminA)
      .set("x-test-role", "ADMIN")
      .expect(403);
  });

  it("the owner may name any org", async () => {
    const res = await list(owner, "SUPER_ADMIN").set("x-org-id", orgB).expect(200);
    expect(res.body.map((r: any) => r.replitUserId)).toContain(staffB);
  });
});
