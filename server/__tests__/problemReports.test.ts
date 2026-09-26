/**
 * The "Problem?" button (v1.2 Phase 8A: UXA-09, UXA-06, UXA-14) against a real
 * database, through the real routes and the real requireRole.
 *
 * Covers: any member of staff reports; the server shapes the screen, scrubs
 * the note and refuses what is off the list; a replayed offline report lands
 * once; the admin-only inbox (managers and cashiers refused) shows the role,
 * never who; admins are told by Signal without a name; Sentry gets role,
 * screen and device tags and no name or note; "Thanks, fixed in version X"
 * reaches the reporter alone, once per version; the per-person rate limit;
 * and one shop cannot see or resolve another's reports.
 *
 * Runs in CI's unit-db job by explicit file name.
 */
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("Problem? reports: inbox, Signals, Sentry, thanks", () => {
  let db: (typeof import("../db"))["db"];
  let schema: typeof import("@shared/schema");
  let signals: typeof import("../services/signals");
  let service: typeof import("../services/problemReports");
  let app: express.Express;
  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const tag = randomUUID().slice(0, 8);
  const samId = `pr-sam-${tag}`;
  const kimId = `pr-kim-${tag}`;
  const alexId = `pr-alex-${tag}`;
  const adaId = `pr-ada-${tag}`;
  const ownerId = `pr-owner-${tag}`;
  const otherAdminId = `pr-other-${tag}`;
  const people = [
    { id: samId, role: "CASHIER", name: "Sam Till", orgId },
    { id: kimId, role: "CASHIER", name: "Kim Till", orgId },
    { id: alexId, role: "MANAGER", name: "Alex Boss", orgId },
    { id: adaId, role: "ADMIN", name: "Ada Admin", orgId },
    { id: ownerId, role: "SUPER_ADMIN", name: "Olive Owner", orgId: null as string | null },
    { id: otherAdminId, role: "ADMIN", name: "Other Admin", orgId: otherOrgId },
  ];
  let actor = samId;
  const sentry: Array<{ message: string; tags: Record<string, string> }> = [];

  const person = (id: string) => people.find((p) => p.id === id)!;
  const as = (id: string) => {
    actor = id;
  };
  let refN = 0;
  const report = (over: Record<string, unknown> = {}) => ({
    clientRef: `pref-${tag}-${++refN}`,
    chip: "too_slow",
    note: null,
    screen: "/operations?pane=order",
    device: "Till 2",
    appVersion: "1.2.0",
    online: true,
    queue: { waiting: 1, failed: 0, needsAttention: 2 },
    reportedAt: new Date().toISOString(),
    ...over,
  });

  beforeAll(async () => {
    process.env.DEV_AUTH_BYPASS = "0";
    ({ db } = await import("../db"));
    schema = await import("@shared/schema");
    signals = await import("../services/signals");
    service = await import("../services/problemReports");
    service.setProblemSentrySender((e) => void sentry.push(e));
    await db.insert(schema.organizations).values([
      { id: orgId, name: "ZZ Problem Test", defaultTaxRate: "0" },
      { id: otherOrgId, name: "ZZ Problem Other", defaultTaxRate: "0" },
    ]);
    await db.insert(schema.allowedUsers).values(
      people.map((p) => ({ replitUserId: p.id, authUserId: p.id, name: p.name, role: p.role as any, orgId: p.orgId })),
    );

    const scoped: RequestHandler = (req: any, _res, next) => {
      const p = person(actor);
      req.orgContext = { orgId: p.orgId ?? orgId, locationId: null, role: p.role };
      req.user = { id: actor, role: p.role, claims: { sub: actor } };
      next();
    };
    const { registerProblemReportRoutes } = await import("../routes/problemReports");
    app = express();
    app.use(express.json());
    registerProblemReportRoutes(app, [scoped]);
  });

  afterAll(async () => {
    service?.setProblemSentrySender(null);
    if (!db) return;
    const { sql, inArray } = await import("drizzle-orm");
    for (const statement of [
      `DELETE FROM org_notification_recipients WHERE org_id IN ('${orgId}', '${otherOrgId}')`,
      `DELETE FROM org_notifications WHERE org_id IN ('${orgId}', '${otherOrgId}')`,
      `DELETE FROM admin_audit_logs WHERE org_id IN ('${orgId}', '${otherOrgId}')`,
      `DELETE FROM problem_reports WHERE org_id IN ('${orgId}', '${otherOrgId}')`,
    ]) {
      try {
        await db.execute(sql.raw(statement));
      } catch (e) {
        console.warn("[problemReports] cleanup", (e as Error).message);
      }
    }
    await db.delete(schema.allowedUsers).where(inArray(schema.allowedUsers.replitUserId, people.map((p) => p.id)));
    await db.delete(schema.organizations).where(inArray(schema.organizations.id, [orgId, otherOrgId]));
  });

  const signalsFor = (id: string, org = orgId) => signals.listSignalsFor(org, { userId: id, role: person(id).role });

  let samReportId = "";

  it("a cashier reports; the server shapes the screen, scrubs the note and keeps the context", async () => {
    as(samId);
    const body = report({
      chip: "error_message",
      screen: "/open-orders/3f2a9c1e-1111-4222-8333-444455556666/refund?q=jane",
      note: "Refund for jane@example.com 07700 900123 said error",
      device: "Till 3",
      online: false,
    });
    const res = await request(app).post("/api/problem-reports").send(body);
    expect(res.status).toBe(201);
    samReportId = res.body.id;
    const { eq } = await import("drizzle-orm");
    const [row] = await db.select().from(schema.problemReports).where(eq(schema.problemReports.id, samReportId));
    expect(row).toMatchObject({
      orgId,
      reporterUserId: samId,
      reporterRole: "CASHIER",
      chip: "error_message",
      screen: "/open-orders/:id/refund",
      device: "Till 3",
      appVersion: "1.2.0",
      online: false,
      status: "open",
    });
    expect(row.queue).toEqual({ waiting: 1, failed: 0, needsAttention: 2 });
    expect(row.note).not.toMatch(/jane@|07700/);
    expect(row.note).toContain("said error");
  });

  it("sends Sentry role, screen and device tags, with no name, id or note", () => {
    const event = sentry.find((e) => e.tags.problem_id === samReportId)!;
    expect(event).toBeTruthy();
    expect(event.tags).toMatchObject({ role: "CASHIER", screen: "/open-orders/:id/refund", device: "Till 3", problem: "error_message", online: "no" });
    const text = JSON.stringify(event);
    expect(text).not.toContain(samId);
    expect(text).not.toContain("Sam");
    expect(text).not.toContain("said error");
  });

  it("tells admins and the owner by Signal, without the reporter's name; not cashiers or managers", async () => {
    const forAda = (await signalsFor(adaId)).filter((s) => s.source === "problem_report");
    expect(forAda).toHaveLength(1);
    expect(forAda[0].title).toBe("Problem? Error message");
    expect(forAda[0].message).not.toContain("Sam");
    expect((await signalsFor(ownerId)).some((s) => s.source === "problem_report")).toBe(true);
    expect((await signalsFor(alexId)).some((s) => s.source === "problem_report")).toBe(false);
    expect((await signalsFor(kimId)).some((s) => s.source === "problem_report")).toBe(false);
  });

  it("a report replayed from the offline queue lands once", async () => {
    as(kimId);
    const body = report({ chip: "cant_find" });
    const first = await request(app).post("/api/problem-reports").send(body);
    const again = await request(app).post("/api/problem-reports").send(body);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ id: first.body.id, duplicate: true });
    expect(sentry.filter((e) => e.tags.problem_id === first.body.id)).toHaveLength(1);
  });

  it("refuses a chip off the list, extra fields, and stores an off-list device as unnamed", async () => {
    as(samId);
    expect((await request(app).post("/api/problem-reports").send(report({ chip: "furious" }))).status).toBe(400);
    expect((await request(app).post("/api/problem-reports").send({ ...report(), reporterName: "Sam" })).status).toBe(400);
    const res = await request(app).post("/api/problem-reports").send(report({ device: "Sam's phone" }));
    expect(res.status).toBe(201);
    const { eq } = await import("drizzle-orm");
    const [row] = await db.select().from(schema.problemReports).where(eq(schema.problemReports.id, res.body.id));
    expect(row.device).toBe("Not named");
  });

  it("the inbox is admin and owner only, and shows the role, never who", async () => {
    as(samId);
    expect((await request(app).get("/api/problem-reports")).status).toBe(403);
    as(alexId);
    expect((await request(app).get("/api/problem-reports")).status).toBe(403);
    as(adaId);
    const res = await request(app).get("/api/problem-reports?status=all");
    expect(res.status).toBe(200);
    const mine = res.body.find((r: any) => r.id === samReportId);
    expect(mine).toMatchObject({ role: "CASHIER", device: "Till 3", chipLabel: "Error message", status: "open" });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(samId);
    expect(text).not.toContain(kimId);
    expect(text).not.toContain("Sam Till");
    expect(Object.keys(mine)).not.toContain("reporterUserId");
    as(ownerId);
    expect((await request(app).get("/api/problem-reports")).status).toBe(200);
  });

  it("another shop's admin cannot see or resolve this shop's reports", async () => {
    as(otherAdminId);
    const list = await request(app).get("/api/problem-reports?status=all");
    expect(list.status).toBe(200);
    expect(list.body.some((r: any) => r.id === samReportId)).toBe(false);
    const res = await request(app).post(`/api/problem-reports/${samReportId}/resolve`).send({ outcome: "fixed", version: "1.2.0" });
    expect(res.status).toBe(404);
  });

  it("only admins resolve, and fixed needs a version", async () => {
    as(alexId);
    expect((await request(app).post(`/api/problem-reports/${samReportId}/resolve`).send({ outcome: "closed" })).status).toBe(403);
    as(adaId);
    expect((await request(app).post(`/api/problem-reports/${samReportId}/resolve`).send({ outcome: "fixed" })).status).toBe(400);
  });

  it("marking it fixed thanks the reporter alone with the version, once per version, and is logged", async () => {
    as(adaId);
    const res = await request(app).post(`/api/problem-reports/${samReportId}/resolve`).send({ outcome: "fixed", version: "1.2.0" });
    expect(res.status).toBe(200);
    expect(res.body.thanked).toBe(true);
    expect(res.body.report).toMatchObject({ status: "fixed", fixedInVersion: "1.2.0" });

    const thanks = (await signalsFor(samId)).filter((s) => s.source === "problem_report_fixed");
    expect(thanks).toHaveLength(1);
    expect(thanks[0].title).toBe("Thanks, fixed in version 1.2.0");
    expect((await signalsFor(kimId)).some((s) => s.source === "problem_report_fixed")).toBe(false);
    expect((await signalsFor(alexId)).some((s) => s.source === "problem_report_fixed")).toBe(false);

    const again = await request(app).post(`/api/problem-reports/${samReportId}/resolve`).send({ outcome: "fixed", version: "1.2.0" });
    expect(again.body.thanked).toBe(false);
    expect((await signalsFor(samId)).filter((s) => s.source === "problem_report_fixed")).toHaveLength(1);

    const { sql } = await import("drizzle-orm");
    const audit = await db.execute(
      sql`SELECT count(*)::int AS n FROM admin_audit_logs WHERE org_id = ${orgId} AND action = 'problem_report.resolved' AND target_id = ${samReportId}`,
    );
    expect(Number((audit as any).rows?.[0]?.n ?? (audit as any)[0]?.n)).toBe(2);
  });

  it("limits one person to a burst of reports", async () => {
    as(alexId);
    const { PROBLEM_RATE_LIMIT } = await import("@shared/problemReports");
    for (let i = 0; i < PROBLEM_RATE_LIMIT; i++) {
      expect((await request(app).post("/api/problem-reports").send(report({ chip: "other" }))).status).toBe(201);
    }
    const res = await request(app).post("/api/problem-reports").send(report({ chip: "other" }));
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("too_many");
  });
});
