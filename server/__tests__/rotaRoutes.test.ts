/**
 * The rota against the real route table and a real database: who is on the
 * roster (staff only, keyed by their sign-in id even after email linking),
 * and the time-off rules — decided once, never by the requester, revocable,
 * range-capped — plus the no-store header on staff names.
 *
 * In CI's unit-db job by explicit file name (.github/workflows/ci.yml). Mocks
 * ../db without a database like myRun.test.ts, so the no-DB run loads it and
 * skips the database half.
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

function dow(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

describe.skipIf(!hasDb)("Rota (database)", () => {
  let app: express.Express;
  let db: any;
  let s: typeof import("@shared/schema");
  const orgId = randomUUID();
  const suffix = orgId.slice(0, 8);
  // A cashier who first signed in under the legacy id and was later linked to
  // a Clerk account by email: the two ids differ.
  const CASHIER_LEGACY = `rota-cashier-legacy-${suffix}`;
  const CASHIER_CLERK = `user_rota_cashier_${suffix}`;
  const MANAGER = `rota-manager-${suffix}`;
  const OTHER_MANAGER = `rota-manager2-${suffix}`;
  const OWNER = `rota-owner-${suffix}`;
  const CUSTOMER = `rota-customer-${suffix}`;
  const FROM = "2030-03-04";

  function as(role: string, user: string) {
    const agent = (method: "get" | "post" | "delete", url: string) =>
      request(app)
        [method](url)
        .set("x-test-role", role)
        .set("x-test-org", orgId)
        .set("x-org-id", orgId)
        .set("x-test-user", user);
    return {
      get: (url: string) => agent("get", url),
      post: (url: string, body: unknown = {}) => agent("post", url).send(body as object),
      delete: (url: string) => agent("delete", url),
    };
  }
  const cashier = () => as("CASHIER", CASHIER_CLERK);
  const manager = () => as("MANAGER", MANAGER);
  const otherManager = () => as("MANAGER", OTHER_MANAGER);

  beforeAll(async () => {
    ({ db } = await import("../db"));
    s = await import("@shared/schema");
    await db.insert(s.organizations).values({ id: orgId, name: "ZZ Rota Org" });
    await db.insert(s.allowedUsers).values([
      { replitUserId: CASHIER_LEGACY, authUserId: CASHIER_CLERK, name: "Casey Cashier", email: "casey@example.test", role: "CASHIER", orgId },
      { replitUserId: MANAGER, authUserId: MANAGER, name: "Mo Manager", role: "MANAGER", orgId },
      { replitUserId: OTHER_MANAGER, authUserId: OTHER_MANAGER, name: "Max Manager", role: "MANAGER", orgId },
      { replitUserId: OWNER, authUserId: OWNER, name: "Olive Owner", role: "SUPER_ADMIN", orgId },
      { replitUserId: CUSTOMER, authUserId: CUSTOMER, name: "Cus Tomer", role: "CUSTOMER", orgId },
    ]);
    // A pattern saved before linking, under the legacy id.
    await db.insert(s.shiftPatterns).values({
      orgId,
      userId: CASHIER_LEGACY,
      dayOfWeek: dow(FROM),
      startTime: "12:00",
      endTime: "20:00",
      effectiveFrom: "2030-01-01",
    });

    const { registerRoutes } = await import("../routes");
    app = express();
    app.use(express.json());
    await registerRoutes(app as any);
  });

  afterAll(async () => {
    if (!db) return;
    const { eq, inArray } = await import("drizzle-orm");
    for (const table of [s.shiftOverrides, s.shiftPatterns, s.timeOffRequests] as any[]) {
      await db.delete(table).where(eq(table.orgId, orgId)).catch((e: Error) => console.warn("[rota] cleanup", e.message));
    }
    await db
      .delete(s.allowedUsers)
      .where(inArray(s.allowedUsers.replitUserId, [CASHIER_LEGACY, MANAGER, OTHER_MANAGER, OWNER, CUSTOMER]))
      .catch(() => {});
    await db.delete(s.organizations).where(eq(s.organizations.id, orgId)).catch(() => {});
  });

  it("lists staff only, by name, under their sign-in id, and keeps legacy-id rows on their line", async () => {
    const res = await cashier().get(`/api/rota?from=${FROM}&days=7`);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toContain("no-store");
    const names = res.body.people.map((p: any) => p.name);
    // An org-less owner account (single-shop installs) is on every roster too, as on the Ops board.
    expect(names).toEqual(expect.arrayContaining(["Casey Cashier", "Max Manager", "Mo Manager", "Olive Owner"]));
    expect(names).toEqual([...names].sort((a: string, b: string) => a.localeCompare(b)));
    expect(names).not.toContain("Cus Tomer");
    const casey = res.body.people.find((p: any) => p.name === "Casey Cashier");
    expect(casey.userId).toBe(CASHIER_CLERK);
    expect(casey.aliases).toEqual(expect.arrayContaining([CASHIER_CLERK, CASHIER_LEGACY]));
    expect(casey.days[0]).toMatchObject({ date: FROM, status: "working", startTime: "12:00", endTime: "20:00" });
    expect(res.body.headcountByDate[FROM]).toBe(1);
    expect(JSON.stringify(res.body)).not.toContain("casey@example.test");
  });

  it("refuses patterns and overrides for anyone not on the roster", async () => {
    const forCustomer = await manager().post("/api/rota/patterns", {
      userId: CUSTOMER,
      dayOfWeek: 1,
      startTime: "09:00",
      endTime: "17:00",
      effectiveFrom: FROM,
    });
    expect(forCustomer.status).toBe(400);
    const forStranger = await manager().post("/api/rota/overrides", { userId: "nobody-at-all", date: FROM, status: "off" });
    expect(forStranger.status).toBe(400);
  });

  it("writes an override given the legacy id under the sign-in id, and resets it back to the pattern", async () => {
    const saved = await manager().post("/api/rota/overrides", {
      userId: CASHIER_LEGACY,
      date: FROM,
      status: "working",
      startTime: "08:00",
      endTime: "12:00",
    });
    expect(saved.status).toBe(200);
    expect(saved.body.userId).toBe(CASHIER_CLERK);
    const grid = await manager().get(`/api/rota?from=${FROM}&days=1`);
    const day = grid.body.people.find((p: any) => p.userId === CASHIER_CLERK).days[0];
    expect(day).toMatchObject({ startTime: "08:00", isOverride: true, overrideId: saved.body.id });

    const reset = await manager().delete(`/api/rota/overrides/${saved.body.id}`);
    expect(reset.status).toBe(204);
    const after = await manager().get(`/api/rota?from=${FROM}&days=1`);
    expect(after.body.people.find((p: any) => p.userId === CASHIER_CLERK).days[0]).toMatchObject({
      startTime: "12:00",
      isOverride: false,
      overrideId: null,
    });
  });

  it("rejects backwards, impossible and over-long time-off ranges", async () => {
    expect((await cashier().post("/api/rota/time-off", { startDate: "2030-03-10", endDate: "2030-03-09" })).status).toBe(400);
    expect((await cashier().post("/api/rota/time-off", { startDate: "2030-02-30", endDate: "2030-03-02" })).status).toBe(400);
    const tooLong = await cashier().post("/api/rota/time-off", { startDate: "2030-03-04", endDate: "2031-03-04" });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.message).toMatch(/at most 62 days/);
  });

  it("approves once, writes every day off, refuses a second decision, and revoking puts the days back", async () => {
    const created = await cashier().post("/api/rota/time-off", { startDate: FROM, endDate: "2030-03-06", reason: "wedding" });
    expect(created.status).toBe(200);
    const id = created.body.id;

    // A cashier cannot decide anything.
    expect((await cashier().post(`/api/rota/time-off/${id}/decide`, { decision: "approved" })).status).toBe(403);

    const approved = await manager().post(`/api/rota/time-off/${id}/decide`, { decision: "approved" });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("approved");

    const again = await otherManager().post(`/api/rota/time-off/${id}/decide`, { decision: "declined" });
    expect(again.status).toBe(409);

    const grid = await cashier().get(`/api/rota?from=${FROM}&days=3`);
    const days = grid.body.people.find((p: any) => p.userId === CASHIER_CLERK).days;
    expect(days.map((d: any) => d.status)).toEqual(["off", "off", "off"]);

    // A day off from an approved request is changed by revoking it, not by deleting the override.
    const blocked = await manager().delete(`/api/rota/overrides/${days[0].overrideId}`);
    expect(blocked.status).toBe(409);

    const revoked = await manager().post(`/api/rota/time-off/${id}/decide`, { decision: "revoked" });
    expect(revoked.status).toBe(200);
    expect(revoked.body.status).toBe("cancelled");
    const after = await cashier().get(`/api/rota?from=${FROM}&days=3`);
    expect(after.body.people.find((p: any) => p.userId === CASHIER_CLERK).days[0]).toMatchObject({ status: "working", isOverride: false });

    // Revoking twice is a conflict, not a silent success.
    expect((await manager().post(`/api/rota/time-off/${id}/decide`, { decision: "revoked" })).status).toBe(409);
  });

  it("shows a linked cashier requests saved under their legacy id, and lets them cancel only their own", async () => {
    const [legacy] = await db
      .insert(s.timeOffRequests)
      .values({ orgId, userId: CASHIER_LEGACY, startDate: "2030-04-01", endDate: "2030-04-01" })
      .returning();
    const [someoneElse] = await db
      .insert(s.timeOffRequests)
      .values({ orgId, userId: MANAGER, startDate: "2030-04-02", endDate: "2030-04-02" })
      .returning();

    const mine = await cashier().get("/api/rota/time-off");
    expect(mine.status).toBe(200);
    const ids = mine.body.map((r: any) => r.id);
    expect(ids).toContain(legacy.id);
    expect(ids).not.toContain(someoneElse.id);

    expect((await cashier().post(`/api/rota/time-off/${someoneElse.id}/cancel`)).status).toBe(403);
    const cancelled = await cashier().post(`/api/rota/time-off/${legacy.id}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("cancelled");
  });

  it("stops a manager deciding their own request; another manager or the owner can", async () => {
    const created = await manager().post("/api/rota/time-off", { startDate: "2030-05-01", endDate: "2030-05-02" });
    expect(created.status).toBe(200);
    const own = await manager().post(`/api/rota/time-off/${created.body.id}/decide`, { decision: "approved" });
    expect(own.status).toBe(403);
    const byColleague = await otherManager().post(`/api/rota/time-off/${created.body.id}/decide`, { decision: "declined" });
    expect(byColleague.status).toBe(200);

    const ownerRequest = await as("SUPER_ADMIN", OWNER).post("/api/rota/time-off", { startDate: "2030-05-03", endDate: "2030-05-03" });
    const selfApproved = await as("SUPER_ADMIN", OWNER).post(`/api/rota/time-off/${ownerRequest.body.id}/decide`, { decision: "approved" });
    expect(selfApproved.status).toBe(200);
  });
  it("a legacy-id override for a date is replaced, not shadowed, by a new write", async () => {
    const date = "2030-06-03";
    await db.insert(s.shiftOverrides).values({ orgId, userId: CASHIER_LEGACY, date, status: "working", startTime: "16:00", endTime: "23:00" });
    const saved = await manager().post("/api/rota/overrides", { userId: CASHIER_CLERK, date, status: "off" });
    expect(saved.status).toBe(200);
    const { and, eq } = await import("drizzle-orm");
    const rows = await db.select().from(s.shiftOverrides).where(and(eq(s.shiftOverrides.orgId, orgId), eq(s.shiftOverrides.date, date)));
    expect(rows.map((r: any) => r.userId)).toEqual([CASHIER_CLERK]);
    const grid = await manager().get(`/api/rota?from=${date}&days=1`);
    expect(grid.body.people.find((p: any) => p.userId === CASHIER_CLERK).days[0].status).toBe("off");
  });

  it("will not let a cell edit overwrite an approved day off, nor a manager give themselves a day off", async () => {
    const created = await cashier().post("/api/rota/time-off", { startDate: "2030-07-01", endDate: "2030-07-01" });
    expect((await manager().post(`/api/rota/time-off/${created.body.id}/decide`, { decision: "approved" })).status).toBe(200);
    const clobber = await manager().post("/api/rota/overrides", { userId: CASHIER_CLERK, date: "2030-07-01", status: "working", startTime: "09:00", endTime: "17:00" });
    expect(clobber.status).toBe(409);

    const selfOff = await manager().post("/api/rota/overrides", { userId: MANAGER, date: "2030-07-02", status: "off" });
    expect(selfOff.status).toBe(403);
    const selfWorking = await manager().post("/api/rota/overrides", { userId: MANAGER, date: "2030-07-02", status: "working", startTime: "10:00", endTime: "14:00" });
    expect(selfWorking.status).toBe(200);
  });

  it("says which one-off shifts an approval replaced", async () => {
    await manager().post("/api/rota/overrides", { userId: CASHIER_CLERK, date: "2030-08-05", status: "working", startTime: "10:00", endTime: "18:00" });
    const created = await cashier().post("/api/rota/time-off", { startDate: "2030-08-05", endDate: "2030-08-06" });
    const approved = await manager().post(`/api/rota/time-off/${created.body.id}/decide`, { decision: "approved" });
    expect(approved.status).toBe(200);
    expect(approved.body.replacedShifts).toEqual([{ date: "2030-08-05", startTime: "10:00", endTime: "18:00" }]);
  });

  it("revoking one of two overlapping approvals keeps the shared day off", async () => {
    const a = await cashier().post("/api/rota/time-off", { startDate: "2030-09-02", endDate: "2030-09-04" });
    const b = await cashier().post("/api/rota/time-off", { startDate: "2030-09-04", endDate: "2030-09-06" });
    await manager().post(`/api/rota/time-off/${a.body.id}/decide`, { decision: "approved" });
    await manager().post(`/api/rota/time-off/${b.body.id}/decide`, { decision: "approved" });
    expect((await manager().post(`/api/rota/time-off/${b.body.id}/decide`, { decision: "revoked" })).status).toBe(200);
    const grid = await manager().get("/api/rota?from=2030-09-02&days=5");
    const days = grid.body.people.find((p: any) => p.userId === CASHIER_CLERK).days.map((d: any) => d.status);
    expect(days.slice(0, 3)).toEqual(["off", "off", "off"]); // A: 2nd–4th, the 4th still off
    expect(days.slice(3)).not.toContain("off"); // B's own days are back
  });

  it("lets a day tagged with a request that is no longer approved be reset", async () => {
    const [req] = await db
      .insert(s.timeOffRequests)
      .values({ orgId, userId: CASHIER_CLERK, startDate: "2030-10-01", endDate: "2030-10-01", status: "declined" })
      .returning();
    const [row] = await db
      .insert(s.shiftOverrides)
      .values({ orgId, userId: CASHIER_CLERK, date: "2030-10-01", status: "off", timeOffRequestId: req.id })
      .returning();
    expect((await manager().delete(`/api/rota/overrides/${row.id}`)).status).toBe(204);
  });
});
