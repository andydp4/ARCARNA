/**
 * The shop's privacy notice and complaints contact (PRV-15) against a real
 * database: empty by default (so every link stays hidden), only ADMIN+ can
 * set it, each change is logged, and the public endpoint returns only what
 * was published, readable signed out. In CI's unit-db job by file name.
 */
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("shop privacy notice and complaints contact", () => {
  let db: (typeof import("../db"))["db"];
  let schema: typeof import("@shared/schema");
  let app: express.Express;
  const orgId = randomUUID();
  let as = "ADMIN";

  beforeAll(async () => {
    process.env.DEV_AUTH_BYPASS = "0";
    ({ db } = await import("../db"));
    schema = await import("@shared/schema");
    await db.insert(schema.organizations).values({ id: orgId, name: "ZZ Privacy Notice Test", tradingName: "ZZ Shop" });
    const scoped: RequestHandler = (req: any, _res, next) => {
      req.orgContext = { orgId, locationId: null, role: as };
      req.user = { id: `privacy-${as}`, role: as, claims: { sub: `privacy-${as}` } };
      next();
    };
    const { registerSettingsOrgRoutes } = await import("../routes/settingsOrg");
    const { registerPrivacyNoticeRoutes } = await import("../routes/privacyNotice");
    app = express();
    app.use(express.json());
    registerPrivacyNoticeRoutes(app); // no auth in front of it, as in routes.ts
    registerSettingsOrgRoutes(app, [scoped]);
  });

  afterAll(async () => {
    await db.delete(schema.adminAuditLogs).where(eq(schema.adminAuditLogs.orgId, orgId));
    await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId));
  });

  it("ships empty, so nothing is shown to customers", async () => {
    const res = await request(app).get(`/api/public/privacy-notice?orgId=${orgId}`).expect(200);
    expect(res.body).toEqual({
      businessName: "ZZ Shop",
      privacyNoticeUrl: "",
      privacyNoticeText: "",
      complaintsContactName: "",
      complaintsContactEmail: "",
    });
  });

  it("a manager cannot change it", async () => {
    as = "MANAGER";
    // requireRole is bypassed only under DEV_AUTH_BYPASS, which is off here.
    await request(app)
      .patch("/api/settings")
      .send({ complaintsContactEmail: "dpo@example.invalid" })
      .expect(403);
    as = "ADMIN";
  });

  it("an admin sets it, it is logged, and the public page shows it", async () => {
    await request(app)
      .patch("/api/settings")
      .send({
        privacyNoticeText: "We use your details to fulfil orders.",
        complaintsContactName: "Sam Owner",
        complaintsContactEmail: "dpo@example.invalid",
      })
      .expect(200);
    const pub = await request(app).get(`/api/public/privacy-notice?orgId=${orgId}`).expect(200);
    expect(pub.body.privacyNoticeText).toBe("We use your details to fulfil orders.");
    expect(pub.body.complaintsContactEmail).toBe("dpo@example.invalid");
    const logs = await db
      .select()
      .from(schema.adminAuditLogs)
      .where(and(eq(schema.adminAuditLogs.orgId, orgId), eq(schema.adminAuditLogs.action, "shop_privacy.updated")));
    expect(logs).toHaveLength(1);
    expect((logs[0].metadata as { fields: string[] }).fields.sort()).toEqual(
      ["complaintsContactEmail", "complaintsContactName", "privacyNoticeText"].sort(),
    );
  });

  it("refuses a non-web link and clears a field with an empty string", async () => {
    await request(app).patch("/api/settings").send({ privacyNoticeUrl: "javascript:alert(1)" }).expect(400);
    await request(app).patch("/api/settings").send({ complaintsContactEmail: "" }).expect(200);
    const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId));
    expect(org.complaintsContactEmail).toBeNull();
  });

  it("answers 404 for an unknown or missing org", async () => {
    await request(app).get(`/api/public/privacy-notice?orgId=${randomUUID()}`).expect(404);
    await request(app).get(`/api/public/privacy-notice`).expect(404);
  });
});
