/**
 * Our own usage record and Friction Truths (v1.2 Phase 8B/8C) against a real
 * database, through the real routes and the real requireRole.
 *
 * Covers: any member of staff's device sends a batch; the role comes from the
 * session and no user id is stored anywhere (Q18); the server shapes screens,
 * scrubs message titles, drops calls that were neither slow nor failed and
 * refuses extra fields; the per-device limit; daily summaries (a late batch
 * recomputes its day without double counting); retention (raw 90 days,
 * summaries 24 months); Friction Truths is the owner's alone and says "not
 * enough data yet" at first; the board is scored per open hour as an
 * information screen; the Monday top five is held back for three weeks,
 * then reaches the owner alone, once; and the study window is off by default
 * and the owner's to change.
 *
 * Runs in CI's unit-db job by explicit file name.
 */
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("Usage record and Friction Truths", () => {
  let db: (typeof import("../db"))["db"];
  let schema: typeof import("@shared/schema");
  let usage: typeof import("../services/usage");
  let d: typeof import("drizzle-orm");
  let app: express.Express;
  const orgId = randomUUID();
  const freshOrgId = randomUUID();
  const tag = randomUUID().slice(0, 8);
  const samId = `ur-sam-${tag}`;
  const alexId = `ur-alex-${tag}`;
  const adaId = `ur-ada-${tag}`;
  const ownerId = `ur-owner-${tag}`;
  const people = [
    { id: samId, role: "CASHIER", name: "Sam Till", orgId: orgId as string | null },
    { id: alexId, role: "MANAGER", name: "Alex Boss", orgId },
    { id: adaId, role: "ADMIN", name: "Ada Admin", orgId },
    { id: ownerId, role: "SUPER_ADMIN", name: "Olive Owner", orgId: null },
  ];
  let actor = samId;
  let actingOrg = orgId;
  const person = (id: string) => people.find((p) => p.id === id)!;
  const as = (id: string, org = orgId) => {
    actor = id;
    actingOrg = org;
  };
  const deviceKey = `dev-${tag}-a`;
  const iso = (dt: Date) => dt.toISOString();
  const daysAgo = (n: number, from = new Date()) => new Date(from.getTime() - n * 86_400_000);

  beforeAll(async () => {
    process.env.DEV_AUTH_BYPASS = "0";
    ({ db } = await import("../db"));
    schema = await import("@shared/schema");
    usage = await import("../services/usage");
    d = await import("drizzle-orm");
    await db.insert(schema.organizations).values([
      { id: orgId, name: "ZZ Usage Test", defaultTaxRate: "0", timezone: "Europe/London" },
      { id: freshOrgId, name: "ZZ Usage Fresh", defaultTaxRate: "0", timezone: "Europe/London" },
    ]);
    await db.insert(schema.allowedUsers).values(
      people.map((p) => ({ replitUserId: p.id, authUserId: p.id, name: p.name, role: p.role as any, orgId: p.orgId })),
    );
    const scoped: RequestHandler = (req: any, _res, next) => {
      const p = person(actor);
      req.orgContext = { orgId: actingOrg, locationId: null, role: p.role };
      req.user = { id: actor, role: p.role, claims: { sub: actor } };
      next();
    };
    const { registerUsageRoutes } = await import("../routes/usage");
    app = express();
    app.use(express.json());
    registerUsageRoutes(app, [scoped]);
  });

  afterAll(async () => {
    if (!db) return;
    const { sql, inArray } = await import("drizzle-orm");
    for (const statement of [
      `DELETE FROM org_notification_recipients WHERE org_id IN ('${orgId}', '${freshOrgId}')`,
      `DELETE FROM org_notifications WHERE org_id IN ('${orgId}', '${freshOrgId}')`,
      `DELETE FROM admin_audit_logs WHERE org_id IN ('${orgId}', '${freshOrgId}')`,
      `DELETE FROM problem_reports WHERE org_id IN ('${orgId}', '${freshOrgId}')`,
      `DELETE FROM usage_events WHERE org_id IN ('${orgId}', '${freshOrgId}')`,
      `DELETE FROM usage_daily WHERE org_id IN ('${orgId}', '${freshOrgId}')`,
      `DELETE FROM usage_study_windows WHERE org_id IN ('${orgId}', '${freshOrgId}')`,
    ]) {
      try {
        await db.execute(sql.raw(statement));
      } catch (e) {
        console.warn("[usageRecord] cleanup", (e as Error).message);
      }
    }
    await db.delete(schema.allowedUsers).where(inArray(schema.allowedUsers.replitUserId, people.map((p) => p.id)));
    await db.delete(schema.organizations).where(inArray(schema.organizations.id, [orgId, freshOrgId]));
  });

  const rowsFor = (org = orgId) => db.select().from(schema.usageEvents).where(d.eq(schema.usageEvents.orgId, org));

  /** Raw rows straight in, for history the route would refuse (older than 30 days). */
  const seed = async (org: string, rows: Array<Partial<typeof schema.usageEvents.$inferInsert> & { occurredAt: Date }>) => {
    await db.insert(schema.usageEvents).values(
      rows.map((r) => ({ orgId: org, kind: "screen", role: "CASHIER", device: "Till 1", deviceKey: `seed-${tag}`, ...r })),
    );
  };

  it("a cashier's device sends a batch; the role comes from the session and nobody is named", async () => {
    as(samId);
    const now = new Date();
    const res = await request(app)
      .post("/api/usage/events")
      .send({
        deviceKey,
        device: "Till 2",
        appVersion: "1.2.0",
        events: [
          { kind: "screen", at: iso(now), screen: "/customers/3f2a9c1e-1111-4222-8333-444455556666?q=jane", activeMs: 90_000, openMs: 60_000 },
          { kind: "message", at: iso(now), screen: "/operations?pane=order", title: "Refunded — order AB12 for Jane Smith", tone: "info" },
          { kind: "message", at: iso(now), screen: "/operations?pane=order", title: "Order failed", tone: "error" },
          { kind: "call", at: iso(now), screen: "/operations?pane=order", method: "POST", route: "/arcarna/api/orders?x=1", ms: 2400, status: 201 },
          { kind: "call", at: iso(now), screen: "/operations?pane=order", method: "GET", route: "/arcarna/api/products", ms: 120, status: 200 },
          { kind: "call", at: iso(now), screen: "/operations?pane=order", method: "GET", route: "/arcarna/api/customers/77", ms: 90, status: 0 },
          { kind: "funnel", at: iso(now), screen: "/operations?pane=order", step: "done" },
        ],
      });
    expect(res.status).toBe(200);
    // The fast, successful call is not friction and is dropped.
    expect(res.body).toEqual({ accepted: 6, dropped: 1, limited: false });

    const rows = await rowsFor();
    expect(rows.every((r) => r.role === "CASHIER" && r.device === "Till 2" && r.appVersion === "1.2.0")).toBe(true);
    const screen = rows.find((r) => r.kind === "screen")!;
    expect(screen.screen).toBe("/customers/:id");
    // Active time can never exceed the time the screen was open.
    expect(screen.activeMs).toBe(60_000);
    const titles = rows.filter((r) => r.kind === "message").map((r) => r.label);
    expect(titles).toContain("Refunded");
    expect(titles).toContain("Order failed");
    expect(JSON.stringify(rows)).not.toMatch(/Jane|AB12|jane/);
    const calls = rows.filter((r) => r.kind === "call");
    expect(calls.map((c) => c.label).sort()).toEqual(["GET /api/customers/:id", "POST /api/orders"]);
    expect(calls.find((c) => c.label === "POST /api/orders")).toMatchObject({ slow: true, failed: false, durationMs: 2400 });
    expect(calls.find((c) => c.label === "GET /api/customers/:id")).toMatchObject({ slow: false, failed: true });
    expect(JSON.stringify(rows)).not.toContain(samId);
  });

  it("has no column that could name a person", async () => {
    const cols = await db.execute(
      d.sql`SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN ('usage_events', 'usage_daily')`,
    );
    const names = ((cols as any).rows ?? cols).map((c: any) => c.column_name as string);
    expect(names.length).toBeGreaterThan(10);
    expect(names.filter((n: string) => /user|name|staff|cashier|person|email|amount|total|text/i.test(n))).toEqual([]);
  });

  it("refuses extra fields (typed text, names) and kinds off the list", async () => {
    as(samId);
    const at = iso(new Date());
    const post = (events: unknown[], extra: Record<string, unknown> = {}) =>
      request(app).post("/api/usage/events").send({ deviceKey, device: "Till 2", events, ...extra });
    expect((await post([{ kind: "screen", at, screen: "/", activeMs: 1, openMs: 1, text: "Jane" }])).status).toBe(400);
    expect((await post([{ kind: "typed", at, screen: "/", value: "4111" }])).status).toBe(400);
    expect((await post([{ kind: "screen", at, screen: "/", activeMs: 1, openMs: 1 }], { userId: samId })).status).toBe(400);
    expect((await post([])).status).toBe(400);
  });

  it("an off-list device is stored as unnamed, and events from far off in time are dropped", async () => {
    as(alexId);
    const res = await request(app)
      .post("/api/usage/events")
      .send({
        deviceKey: `dev-${tag}-b`,
        device: "Alex's phone",
        events: [
          { kind: "crash", at: iso(new Date()), screen: "/stock-levels", crash: "boundary" },
          { kind: "crash", at: iso(daysAgo(45)), screen: "/stock-levels", crash: "boundary" },
          { kind: "crash", at: iso(new Date(Date.now() + 3_600_000)), screen: "/stock-levels", crash: "boundary" },
        ],
      });
    expect(res.body).toEqual({ accepted: 1, dropped: 2, limited: false });
    const [row] = (await rowsFor()).filter((r) => r.deviceKey === `dev-${tag}-b`);
    expect(row).toMatchObject({ device: "Not named", role: "MANAGER", kind: "crash", label: "boundary" });
  });

  it("limits each device, not the shop's shared address", async () => {
    const { DEVICE_EVENTS_PER_HOUR } = await import("@shared/usage");
    const busyKey = `dev-${tag}-busy`;
    const now = new Date();
    await seed(
      orgId,
      Array.from({ length: DEVICE_EVENTS_PER_HOUR - 2 }, () => ({ deviceKey: busyKey, occurredAt: now, receivedAt: now })),
    );
    as(samId);
    const batch = (key: string) => ({
      deviceKey: key,
      device: "Till 1",
      events: Array.from({ length: 5 }, () => ({ kind: "funnel", at: iso(new Date()), screen: "/operations?pane=order", step: "start" })),
    });
    const first = await request(app).post("/api/usage/events").send(batch(busyKey));
    expect(first.body).toEqual({ accepted: 2, dropped: 3, limited: true });
    const second = await request(app).post("/api/usage/events").send(batch(busyKey));
    expect(second.status).toBe(429);
    expect(second.body.code).toBe("device_limit");
    // Another till in the same shop is unaffected.
    const other = await request(app).post("/api/usage/events").send(batch(`dev-${tag}-other`));
    expect(other.body.accepted).toBe(5);
    await db.execute(d.sql`DELETE FROM usage_events WHERE org_id = ${orgId} AND device_key IN (${busyKey}, ${`dev-${tag}-other`})`);
  });

  it("limits the shop too, so a fresh device key does not buy a fresh allowance", async () => {
    const { ORG_EVENTS_PER_HOUR } = await import("@shared/usage");
    const { sql } = await import("drizzle-orm");
    const now = new Date();
    // The shop has nearly used its hour, spread over many keys (as a build that
    // makes a new key on every load would).
    const existing = await db.execute(
      sql`SELECT count(*)::int AS n FROM usage_events WHERE org_id = ${orgId} AND received_at >= now() - interval '1 hour'`,
    );
    const total = ORG_EVENTS_PER_HOUR - 3 - Number(((existing as any).rows ?? existing)[0].n);
    for (let i = 0; i < total; i += 2_000) {
      await seed(
        orgId,
        Array.from({ length: Math.min(2_000, total - i) }, (_, j) => ({ deviceKey: `dev-${tag}-k${i + j}`, occurredAt: now, receivedAt: now })),
      );
    }
    as(samId);
    const batch = (key: string) => ({
      deviceKey: key,
      device: "Till 1",
      events: Array.from({ length: 5 }, () => ({ kind: "funnel", at: iso(new Date()), screen: "/operations?pane=order", step: "start" })),
    });
    const first = await request(app).post("/api/usage/events").send(batch(`dev-${tag}-fresh1`));
    expect(first.body).toEqual({ accepted: 3, dropped: 2, limited: true });
    const second = await request(app).post("/api/usage/events").send(batch(`dev-${tag}-fresh2`));
    expect(second.status).toBe(429);
    expect(second.body.code).toBe("shop_limit");
    await db.execute(sql`DELETE FROM usage_events WHERE org_id = ${orgId} AND device_key LIKE ${`dev-${tag}-%`}`);
  });

  it("Friction Truths and the study setting are the owner's alone", async () => {
    for (const id of [samId, alexId, adaId]) {
      as(id);
      expect((await request(app).get("/api/friction-truths")).status).toBe(403);
      expect((await request(app).put("/api/usage/study-window").send({ enabled: false, screens: [], endsOn: null })).status).toBe(403);
    }
    as(ownerId);
    expect((await request(app).get("/api/friction-truths")).status).toBe(200);
  });

  it('says "not enough data yet" and ranks nothing in the first two weeks', async () => {
    as(ownerId, freshOrgId);
    await seed(freshOrgId, [{ occurredAt: daysAgo(3), activeMs: 3_600_000, openMs: 3_600_000, screen: "/stock-levels" }]);
    const res = await request(app).get("/api/friction-truths");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ enoughData: false, daysOfData: 3, pain: null, messages: null, roles: null, funnel: null, slowCalls: null });
    expect(res.body.devices).toHaveLength(1);
  });

  it("ranks pain per active hour, scores the board per open hour, and shows messages, roles, funnel, calls and devices", async () => {
    await db.execute(d.sql`DELETE FROM usage_events WHERE org_id = ${orgId}`);
    await db.execute(d.sql`DELETE FROM usage_daily WHERE org_id = ${orgId}`);
    const t = (n: number) => {
      const x = daysAgo(n);
      x.setUTCHours(12, 0, 0, 0);
      return x;
    };
    await seed(orgId, [
      // Till: 2 active hours, 1 crash, 2 failed calls, 3 slow calls, 1 error message.
      { occurredAt: t(20), screen: "/operations?pane=order", activeMs: 3_600_000, openMs: 4_000_000 },
      { occurredAt: t(5), screen: "/operations?pane=order", activeMs: 3_600_000, openMs: 4_000_000, role: "MANAGER" },
      { occurredAt: t(5), kind: "crash", screen: "/operations?pane=order", label: "boundary" },
      { occurredAt: t(5), kind: "call", screen: "/operations?pane=order", label: "POST /api/orders", failed: true, durationMs: 800 },
      { occurredAt: t(4), kind: "call", screen: "/operations?pane=order", label: "POST /api/orders", failed: true, durationMs: 900 },
      ...[1, 2, 3].map((i) => ({ occurredAt: t(i), kind: "call", screen: "/operations?pane=order", label: "GET /api/products", slow: true, durationMs: 2000 })),
      { occurredAt: t(2), kind: "message", screen: "/operations?pane=order", label: "Order failed", failed: true },
      { occurredAt: t(2), kind: "message", screen: "/stock-levels", label: "Saved" },
      // Board: nobody touches it (active 0) but open 10 hours; 2 slow calls.
      { occurredAt: t(3), screen: "/operations", activeMs: 0, openMs: 36_000_000, device: "Counter tablet" },
      ...[1, 2].map((i) => ({ occurredAt: t(i), kind: "call", screen: "/operations", label: "GET /api/orders/board", slow: true, durationMs: 1800 })),
      ...(["start", "pay", "submit", "done"] as const).map((step) => ({ occurredAt: t(2), kind: "funnel", screen: "/operations?pane=order", label: step })),
      { occurredAt: t(2), kind: "offline", screen: "", durationMs: 120_000 },
    ]);
    // A Problem? report on the till screen counts too.
    await db.insert(schema.problemReports).values({
      orgId,
      reporterUserId: samId,
      reporterRole: "CASHIER",
      clientRef: `ur-${tag}-1`,
      chip: "too_slow",
      screen: "/operations?pane=order",
      device: "Till 1",
      online: true,
      queue: { waiting: 0, failed: 0, needsAttention: 0 },
      createdAt: t(2),
    });

    as(ownerId);
    const res = await request(app).get("/api/friction-truths?weeks=4");
    expect(res.status).toBe(200);
    const b = res.body;
    expect(b.enoughData).toBe(true);
    const till = b.pain.find((p: any) => p.screen === "/operations?pane=order");
    // 1 crash (5) + 1 problem (3) + 1 error message (2) + 2 failed (4) + 3 slow (3) = 17 over 2 active hours.
    expect(till).toMatchObject({ crashes: 1, problems: 1, errorMessages: 1, failedCalls: 2, slowCalls: 3, weighted: 17, hours: 2, painPerHour: 8.5, information: false });
    const board = b.pain.find((p: any) => p.screen === "/operations");
    expect(board).toMatchObject({ information: true, hours: 10, painPerHour: 0.2 });
    expect(b.pain[0].screen).toBe("/operations?pane=order");

    expect(b.messages.find((m: any) => m.title === "Order failed")).toMatchObject({ errors: 1, topScreen: "/operations?pane=order" });
    const roles = Object.fromEntries(b.roles.map((r: any) => [r.role, r.activeHours]));
    expect(roles.MANAGER).toBe(1);
    expect(b.funnel.find((f: any) => f.role === "CASHIER").steps).toMatchObject({ start: 1, pay: 1, submit: 1, done: 1 });
    expect(b.slowCalls.find((c: any) => c.call === "GET /api/products")).toMatchObject({ slow: 3, avgMs: 2000 });
    const counter = b.devices.find((x: any) => x.device === "Counter tablet");
    expect(counter).toBeTruthy();
    const till1 = b.devices.find((x: any) => x.device === "Till 1");
    expect(till1).toMatchObject({ offlineMinutes: 2, offlineTimes: 1, crashes: 1 });
    expect(JSON.stringify(b)).not.toMatch(/Sam|ur-sam/);
  });

  it("a late batch recomputes its day without counting anything twice", async () => {
    await usage.rollupUsage(orgId);
    const sum = async () => {
      const [r] = await db
        .select({ n: d.sql<number>`sum(${schema.usageDaily.count})::int` })
        .from(schema.usageDaily)
        .where(d.and(d.eq(schema.usageDaily.orgId, orgId), d.eq(schema.usageDaily.kind, "crash")));
      return Number(r.n) || 0;
    };
    const before = await sum();
    await usage.rollupUsage(orgId);
    expect(await sum()).toBe(before);
    await seed(orgId, [{ occurredAt: daysAgo(5), kind: "crash", screen: "/operations?pane=order", label: "script" }]);
    await usage.rollupUsage(orgId);
    expect(await sum()).toBe(before + 1);
  });

  it("keeps raw events 90 days and summaries 24 months", async () => {
    await seed(orgId, [
      { occurredAt: daysAgo(91), screen: "/old-raw" },
      { occurredAt: daysAgo(89), screen: "/kept-raw" },
    ]);
    await db.insert(schema.usageDaily).values([
      { orgId, day: "2000-01-01", kind: "screen", role: "CASHIER", device: "Till 1", screen: "/ancient", count: 1 },
    ]);
    await usage.purgeUsage();
    const screens = (await rowsFor()).map((r) => r.screen);
    expect(screens).not.toContain("/old-raw");
    expect(screens).toContain("/kept-raw");
    const daily = await db.select().from(schema.usageDaily).where(d.eq(schema.usageDaily.orgId, orgId));
    expect(daily.some((r) => r.screen === "/ancient")).toBe(false);
    // The 91-day-old event was counted into its day's summary before it went.
    expect(daily.some((r) => r.screen === "/old-raw")).toBe(true);
  });

  it("the Monday top five is held back until three weeks of data, then reaches the owner alone, once", async () => {
    const { weekKeyFor } = await import("@shared/review/exceptions");
    // The most recent Monday, 10:00 UTC (09:00 or 10:00 in London).
    const monday = new Date();
    monday.setUTCHours(10, 0, 0, 0);
    while (monday.getUTCDay() !== 1) monday.setUTCDate(monday.getUTCDate() - 1);
    const weekKey = weekKeyFor(monday, "Europe/London").key;

    const weeklyFor = (org: string) =>
      db
        .select()
        .from(schema.orgNotifications)
        .where(d.and(d.eq(schema.orgNotifications.orgId, org), d.eq(schema.orgNotifications.source, "friction_weekly")));

    // This shop: data from 25 days before that Monday, and last week's pain.
    await db.execute(d.sql`DELETE FROM usage_events WHERE org_id = ${orgId}`);
    await db.execute(d.sql`DELETE FROM usage_daily WHERE org_id = ${orgId}`);
    const at = (n: number) => {
      const x = new Date(monday.getTime() - n * 86_400_000);
      x.setUTCHours(12, 0, 0, 0);
      return x;
    };
    await seed(orgId, [
      { occurredAt: at(25), screen: "/stock-levels", activeMs: 3_600_000, openMs: 3_600_000 },
      { occurredAt: at(3), screen: "/stock-levels", activeMs: 3_600_000, openMs: 3_600_000 },
      { occurredAt: at(3), kind: "crash", screen: "/stock-levels", label: "boundary" },
      { occurredAt: at(3), screen: "/customers", activeMs: 7_200_000, openMs: 7_200_000 },
      { occurredAt: at(2), kind: "call", screen: "/customers", label: "GET /api/customers", slow: true, durationMs: 2000 },
    ]);
    // A report fixed last week, on the stock screen.
    await db.insert(schema.problemReports).values({
      orgId,
      reporterUserId: samId,
      reporterRole: "CASHIER",
      clientRef: `ur-${tag}-2`,
      chip: "error_message",
      screen: "/stock-levels",
      device: "Till 1",
      online: true,
      queue: { waiting: 0, failed: 0, needsAttention: 0 },
      status: "fixed",
      fixedInVersion: "1.2.1",
      resolvedAt: at(4),
      createdAt: at(10),
    });

    // Not Monday yet (Sunday): nothing.
    expect(await usage.runWeeklyFrictionTopFive(new Date(monday.getTime() - 86_400_000))).toBe(0);
    // freshOrg's data starts three days ago: held back.
    await usage.runWeeklyFrictionTopFive(monday);
    expect(await weeklyFor(freshOrgId)).toHaveLength(0);
    await usage.runWeeklyFrictionTopFive(new Date(monday.getTime() + 3_600_000));
    const sent = await weeklyFor(orgId);
    expect(sent).toHaveLength(1);
    expect((sent[0].metadata as any).week).toBe(weekKey);
    expect(sent[0].message).toContain("1. /stock-levels: 5.0 per active hour (1 crash in 1.0 active hours");
    expect(sent[0].message).toContain("/customers");
    expect(sent[0].message).toContain("Fixed last week: did it work?");
    expect(sent[0].message).toContain("/stock-levels (fixed in 1.2.1)");

    const recipients = await db
      .select({ userId: schema.orgNotificationRecipients.userId })
      .from(schema.orgNotificationRecipients)
      .where(d.eq(schema.orgNotificationRecipients.notificationId, sent[0].id));
    const ids = recipients.map((r) => r.userId);
    expect(ids).toContain(ownerId);
    expect(ids).not.toContain(adaId);
    expect(ids).not.toContain(alexId);
    expect(ids).not.toContain(samId);
  });

  it("the study window is off by default, at most 14 days, and the owner's change is logged", async () => {
    as(samId);
    const off = await request(app).get("/api/usage/study-window");
    expect(off.body).toMatchObject({ enabled: false, active: false, screens: [], recorderConnected: false });

    as(ownerId);
    const today = new Date().toISOString().slice(0, 10);
    const far = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    expect((await request(app).put("/api/usage/study-window").send({ enabled: true, screens: ["/stock-levels"], endsOn: far })).status).toBe(400);
    expect((await request(app).put("/api/usage/study-window").send({ enabled: true, screens: [], endsOn: today })).status).toBe(400);
    const endsOn = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const saved = await request(app)
      .put("/api/usage/study-window")
      .send({ enabled: true, screens: ["/stock-levels?q=jane", "/customers/3f2a9c1e-1111-4222-8333-444455556666"], endsOn });
    expect(saved.status).toBe(200);
    expect(saved.body.screens).toEqual(["/stock-levels", "/customers/:id"]);

    as(samId);
    const on = await request(app).get("/api/usage/study-window");
    expect(on.body).toMatchObject({ enabled: true, active: true, endsOn, screens: ["/stock-levels", "/customers/:id"] });

    const audit = await db.execute(
      d.sql`SELECT count(*)::int AS n FROM admin_audit_logs WHERE org_id = ${orgId} AND action = 'usage.study_window.saved'`,
    );
    expect(Number((audit as any).rows?.[0]?.n ?? (audit as any)[0]?.n)).toBe(1);
  });
});
