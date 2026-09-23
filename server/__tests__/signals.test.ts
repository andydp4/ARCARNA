/**
 * Signals end to end (v1.2 Phase 0B, FIX-08 / CMP-01): `notify()` resolves
 * recipients from the real allowed_users table — including the owner, whose
 * SUPER_ADMIN row has no org — and the Signals routes serve each person only
 * what is theirs, with their own read and cleared state.
 *
 * Runs against a real database, in CI's unit-db job by explicit file name.
 */
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("Signals", () => {
  let db: (typeof import("../db"))["db"];
  let schema: typeof import("@shared/schema");
  let notify: (typeof import("../services/signals"))["notify"];
  let app: express.Express;
  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const tag = randomUUID().slice(0, 8);
  const id = (who: string) => `sig-${who}-${tag}`;
  const roles: Record<string, string> = {
    owner: "SUPER_ADMIN",
    admin: "ADMIN",
    manager: "MANAGER",
    manager2: "MANAGER",
    cashier: "CASHIER",
    cashier2: "CASHIER",
    outsider: "MANAGER",
  };
  let as = "manager";
  // The shared test database has its own SUPER_ADMIN logins (seed), and every
  // one of them is rightly a recipient too; assert on this suite's people.
  const ours = (recipients: string[]) => recipients.filter((r) => r.endsWith(tag)).sort();

  beforeAll(async () => {
    process.env.DEV_AUTH_BYPASS = "0";
    ({ db } = await import("../db"));
    schema = await import("@shared/schema");
    ({ notify } = await import("../services/signals"));
    await db.insert(schema.organizations).values([
      { id: orgId, name: "ZZ Signals Test" },
      { id: otherOrgId, name: "ZZ Signals Other" },
    ]);
    await db.insert(schema.allowedUsers).values(
      Object.entries(roles).map(([who, role]) => ({
        replitUserId: id(who),
        authUserId: id(who),
        name: who,
        role: role as any,
        // The owner's login has no fixed organisation.
        orgId: who === "owner" ? null : who === "outsider" ? otherOrgId : orgId,
      })),
    );

    const scoped: RequestHandler = (req: any, _res, next) => {
      req.orgContext = { orgId, locationId: null, role: roles[as] };
      req.user = { id: id(as), role: roles[as], claims: { sub: id(as) } };
      next();
    };
    const { registerOperationalRoutes } = await import("../routes/operational");
    app = express();
    app.use(express.json());
    registerOperationalRoutes(app, [scoped]);
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.orgNotifications).where(inArray(schema.orgNotifications.orgId, [orgId, otherOrgId]));
    await db.delete(schema.allowedUsers).where(inArray(schema.allowedUsers.replitUserId, Object.keys(roles).map(id)));
    await db.delete(schema.organizations).where(inArray(schema.organizations.id, [orgId, otherOrgId]));
  });

  async function bell(who: string) {
    as = who;
    const res = await request(app).get("/api/notifications");
    expect(res.status).toBe(200);
    return (res.body.items as Array<{ id: string; title: string; readAt: string | null; persisted?: boolean; type: string }>);
  }

  it("sends a personal-use Signal to managers and up, never the cashier it names, a colleague or another org", async () => {
    const { id: signalId, recipients } = await notify({
      orgId,
      title: `Personal use — ${tag}`,
      message: "cashier took 1 × Cola",
      source: "personal_use",
      severity: "warning",
      subjectUserId: id("cashier"),
    });
    expect(ours(recipients)).toEqual([id("admin"), id("manager"), id("manager2"), id("owner")].sort());

    for (const who of ["owner", "admin", "manager", "manager2"]) {
      expect((await bell(who)).map((n) => n.id)).toContain(signalId);
    }
    for (const who of ["cashier", "cashier2"]) {
      expect((await bell(who)).map((n) => n.id)).not.toContain(signalId);
    }
  });

  it("sends commission paid to admins and the owner only", async () => {
    const { recipients } = await notify({
      orgId,
      title: "Cashier commission paid",
      message: "paid",
      source: "cashier_commission",
      subjectUserId: id("cashier"),
    });
    expect(ours(recipients)).toEqual([id("admin"), id("owner")].sort());
    expect((await bell("manager")).some((n) => n.title === "Cashier commission paid")).toBe(false);
  });

  it("reaches the owner even when an admin-only Signal has nobody else to go to", async () => {
    const { id: signalId, recipients } = await notify({
      orgId,
      title: "About the admin",
      message: "names the admin",
      source: "cashier_commission",
      subjectUserId: id("admin"),
    });
    expect(ours(recipients)).toEqual([id("owner")]);
    expect((await bell("owner")).map((n) => n.id)).toContain(signalId);
    expect((await bell("admin")).map((n) => n.id)).not.toContain(signalId);
  });

  it("keeps read and cleared per person", async () => {
    const { id: signalId } = await notify({ orgId, title: `Per person ${tag}`, message: "x", source: "daily_close" });

    as = "manager";
    expect((await request(app).patch(`/api/org-notifications/${signalId}/read`)).status).toBe(200);
    expect((await bell("manager")).find((n) => n.id === signalId)?.readAt).toBeTruthy();
    expect((await bell("manager2")).find((n) => n.id === signalId)?.readAt).toBeNull();

    as = "manager";
    expect((await request(app).post(`/api/org-notifications/${signalId}/dismiss`)).status).toBe(200);
    expect((await bell("manager")).map((n) => n.id)).not.toContain(signalId);
    expect((await bell("manager2")).map((n) => n.id)).toContain(signalId);
    expect((await bell("admin")).map((n) => n.id)).toContain(signalId);
  });

  it("lets the owner mark a Signal read even without a recipient row", async () => {
    const [row] = await db
      .insert(schema.orgNotifications)
      .values({ orgId, title: "Pre-owner", message: "x", source: "daily_close", audience: { minRole: "MANAGER" } })
      .returning();
    as = "owner";
    expect((await request(app).patch(`/api/org-notifications/${row.id}/read`)).status).toBe(200);
    expect((await bell("owner")).find((n) => n.id === row.id)?.readAt).toBeTruthy();
  });

  it("refuses a cashier who marks or clears a Signal not addressed to them", async () => {
    const { id: signalId } = await notify({ orgId, title: "Managers only", message: "x", source: "daily_close" });
    as = "cashier";
    expect((await request(app).patch(`/api/org-notifications/${signalId}/read`)).status).toBe(404);
    expect((await request(app).post(`/api/org-notifications/${signalId}/dismiss`)).status).toBe(404);
    const [rec] = await db
      .select()
      .from(schema.orgNotificationRecipients)
      .where(eq(schema.orgNotificationRecipients.notificationId, signalId));
    expect(rec.userId).not.toBe(id("cashier"));
  });

  it("shows a cashier only what is addressed to them, and no stock or approval Signals", async () => {
    const { id: mine } = await notify({
      orgId,
      title: "For you",
      message: "x",
      source: "shift_note",
      audience: { userIds: [id("cashier")] },
    });
    const items = await bell("cashier");
    expect(items.map((n) => n.id)).toEqual([mine]);
    expect(items.every((n) => n.persisted)).toBe(true);
    expect((await bell("cashier2")).map((n) => n.id)).not.toContain(mine);
  });

  it("marks all read for the caller only", async () => {
    const { id: signalId } = await notify({ orgId, title: "Read all", message: "x", source: "daily_close" });
    as = "admin";
    expect((await request(app).post("/api/org-notifications/read-all")).status).toBe(200);
    expect((await bell("admin")).find((n) => n.id === signalId)?.readAt).toBeTruthy();
    expect((await bell("manager")).find((n) => n.id === signalId)?.readAt).toBeNull();
  });
});
