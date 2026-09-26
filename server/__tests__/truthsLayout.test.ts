/**
 * Truths at a glance (v1.2 Phase 3) against a real database: one org-wide
 * layout, changed only by admins through a logged route; a manager reads the
 * same layout minus the widgets above their role (Profit Truths).
 *
 * In CI's unit-db job by explicit file name.
 */
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { adminAuditLogs, orgTruthsLayouts, organizations } from "@shared/schema";
import { DEFAULT_TRUTHS_LAYOUT } from "@shared/truthsLayout";

const hasDb = !!process.env.DATABASE_URL;

// The real requireRole waves everything through when the dev bypass is on.
process.env.DEV_AUTH_BYPASS = "0";

describe.skipIf(!hasDb)("Truths at a glance layout", () => {
  let db: (typeof import("../db"))["db"];
  let orgId: string;

  async function appAs(role: string) {
    const scoped: RequestHandler = (req: any, _res, next) => {
      const id = `truths-${role.toLowerCase()}`;
      req.orgContext = { orgId, locationId: null, role };
      req.user = { id, role, claims: { sub: id } };
      next();
    };
    const { registerTruthsLayoutRoutes } = await import("../routes/truthsLayout");
    const app = express();
    app.use(express.json());
    registerTruthsLayoutRoutes(app, [scoped]);
    return app;
  }

  beforeEach(async () => {
    ({ db } = await import("../db"));
    orgId = randomUUID();
    await db.insert(organizations).values({ id: orgId, name: "Truths Layout Test" });
  });

  afterEach(async () => {
    await db.delete(adminAuditLogs).where(eq(adminAuditLogs.orgId, orgId));
    await db.delete(orgTruthsLayouts).where(eq(orgTruthsLayouts.orgId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("serves the default layout (today's Truths Hub) until an admin saves one", async () => {
    const res = await request(await appAs("MANAGER")).get("/api/truths/layout").expect(200);
    expect(res.body.isDefault).toBe(true);
    expect(res.body.widgets).toEqual(DEFAULT_TRUTHS_LAYOUT);
  });

  it("lets an admin add Busiest Hours and shows a manager the same layout, minus Profit Truths", async () => {
    const admin = await appAs("ADMIN");
    const widgets = [
      { id: "busiest-hours", size: "large", window: "last12w" },
      { id: "profit-truths", size: "medium", window: "month" },
      { id: "evidence-guide", size: "large", window: "none" },
    ];
    await request(admin).put("/api/truths/layout").send({ widgets }).expect(200);

    const asAdmin = await request(admin).get("/api/truths/layout").expect(200);
    expect(asAdmin.body.isDefault).toBe(false);
    expect(asAdmin.body.widgets.map((w: { id: string }) => w.id)).toEqual(["busiest-hours", "profit-truths", "evidence-guide"]);

    const asManager = await request(await appAs("MANAGER")).get("/api/truths/layout").expect(200);
    expect(asManager.body.widgets.map((w: { id: string }) => w.id)).toEqual(["busiest-hours", "evidence-guide"]);
    // Not even the id of a widget above their role reaches a manager.
    expect(asManager.text).not.toContain("profit");
  });

  it("logs every save with what was there before", async () => {
    const admin = await appAs("ADMIN");
    await request(admin).put("/api/truths/layout").send({ widgets: [{ id: "stock-turn" }] }).expect(200);
    await request(admin).put("/api/truths/layout").send({ widgets: [{ id: "order-channels", size: "small" }] }).expect(200);

    const logs = await db
      .select()
      .from(adminAuditLogs)
      .where(and(eq(adminAuditLogs.orgId, orgId), eq(adminAuditLogs.action, "truths_layout.saved")))
      .orderBy(adminAuditLogs.createdAt);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ actorUserId: "truths-admin", actorRole: "ADMIN", targetId: orgId });
    expect(logs[0].metadata).toEqual({ widgets: ["stock-turn:medium:last90"], previous: null });
    expect(logs[1].metadata).toEqual({ widgets: ["order-channels:small:last90"], previous: ["stock-turn:medium:last90"] });
  });

  it("refuses a manager's or cashier's save and leaves the layout alone", async () => {
    for (const role of ["MANAGER", "CASHIER"]) {
      await request(await appAs(role)).put("/api/truths/layout").send({ widgets: [{ id: "stock-turn" }] }).expect(403);
    }
    await request(await appAs("CASHIER")).get("/api/truths/layout").expect(403);
    const rows = await db.select().from(orgTruthsLayouts).where(eq(orgTruthsLayouts.orgId, orgId));
    expect(rows).toHaveLength(0);
  });

  it("refuses a layout the editor would not offer, and logs nothing", async () => {
    const admin = await appAs("ADMIN");
    const bad = await request(admin).put("/api/truths/layout").send({ widgets: [{ id: "evidence:ARC-T1-006" }] }).expect(400);
    expect(bad.body.code).toBe("VALIDATION_ERROR");
    await request(admin).put("/api/truths/layout").send({ widgets: "all of them" }).expect(400);
    const logs = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.orgId, orgId));
    expect(logs).toHaveLength(0);
  });

  it("keeps each org's layout to itself", async () => {
    await request(await appAs("ADMIN")).put("/api/truths/layout").send({ widgets: [{ id: "stock-turn" }] }).expect(200);
    const otherOrg = orgId;
    orgId = randomUUID();
    await db.insert(organizations).values({ id: orgId, name: "Other Truths Org" });
    try {
      const res = await request(await appAs("ADMIN")).get("/api/truths/layout").expect(200);
      expect(res.body.isDefault).toBe(true);
    } finally {
      await db.delete(organizations).where(eq(organizations.id, orgId));
      orgId = otherOrg;
    }
  });

  it("drops a stored widget that has left the catalogue instead of breaking the page", async () => {
    await db.insert(orgTruthsLayouts).values({
      orgId,
      widgets: [
        { id: "retired-widget", size: "small", window: "month" },
        { id: "stock-turn", size: "medium", window: "last30" },
      ],
    });
    const res = await request(await appAs("MANAGER")).get("/api/truths/layout").expect(200);
    expect(res.body.widgets).toEqual([{ id: "stock-turn", size: "medium", window: "last30" }]);
  });
});
