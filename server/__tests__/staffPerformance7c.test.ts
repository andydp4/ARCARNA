/**
 * Staff Performance 7C (benefit, speed, targets and people) against a real
 * database.
 *
 *  - Setting a target changes the colours; only admins can, and each change
 *    is a new version (an UPDATE is refused).
 *  - A cashier gets My performance — their own figures, no one else's name,
 *    no margin or cost — and is refused the Evidence pages.
 *  - Managers' digests contain no other managers' rows; cashiers' none at all.
 *  - A team median only with 4+ people.
 *  - Loss-prevention flags land in Needs a look: cashiers' reach managers,
 *    managers' reach admins only; a re-run raises nothing twice.
 *  - Satisfaction: one rating per order, with who rated it and where.
 *  - Benefit (£) on the Evidence row: margin on the commission basis, Net benefit.
 *
 * In CI's unit-db job by explicit file name (.github/workflows/ci.yml).
 */
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  adminAuditLogs,
  allowedUsers,
  cashierShifts,
  customers,
  dailyCloseRuns,
  exceptionReviews,
  orderEvents,
  orderItems,
  orgNotifications,
  orders,
  organizations,
  refunds,
  satisfactionScores,
  staffTargets,
  staffWeeklyRuns,
} from "@shared/schema";

const hasDb = !!process.env.DATABASE_URL;
const tag = randomUUID().slice(0, 8);
const id = (who: string) => `p7c_${who}_${tag}`;
const CARA = id("cara");
const CODY = id("cody");
const MIA = id("mia");
const MAX = id("max");
const ADA = id("ada");

// Mon 2 – Sun 8 February 2026 (GMT: trading days run 06:00Z to 06:00Z).
const WEEK = { from: "2026-02-02", to: "2026-02-08" };
const at = (iso: string, hhmm: string) => new Date(`${iso}T${hhmm}:00.000Z`);

describe.skipIf(!hasDb)("Staff Performance 7C on real data", () => {
  let db: (typeof import("../db"))["db"];
  let orgId: string;
  const orderIds: Record<string, string> = {};

  beforeAll(async () => {
    process.env.DEV_AUTH_BYPASS = "0";
    ({ db } = await import("../db"));
    orgId = randomUUID();
    await db.insert(organizations).values({ id: orgId, name: `Staff 7C ${tag}`, timezone: "Europe/London" } as never);
    await db.insert(allowedUsers).values(
      [
        [CARA, "Cara Cashier", "CASHIER"],
        [CODY, "Cody Cashier", "CASHIER"],
        [MIA, "Mia Manager", "MANAGER"],
        [MAX, "Max Manager", "MANAGER"],
        [ADA, "Ada Admin", "ADMIN"],
      ].map(([u, name, role]) => ({ replitUserId: u, authUserId: u, name, role, orgId })) as never,
    );
    const [c] = await db.insert(customers).values({ orgId, name: "Priya Shah", phone: "07700 900123" }).returning();

    const make = async (key: string, v: Partial<typeof orders.$inferInsert>) => {
      const [o] = await db
        .insert(orders)
        .values({ orgId, paymentMethod: "cash", status: "completed", ...v } as never)
        .returning();
      orderIds[key] = o.id;
      return o.id;
    };
    await make("cara1", {
      total: "20.00",
      settledTotal: "20.00",
      subtotal: "21.00",
      tierDiscount: "1.00",
      inputUserId: CARA,
      completedUserId: CARA,
      customerId: c.id,
      enteredAt: at("2026-02-02", "11:00"),
      createdAt: at("2026-02-02", "11:00"),
      etaGiven: at("2026-02-02", "11:20"),
      readyAt: at("2026-02-02", "11:10"),
      settledAt: at("2026-02-02", "11:30"),
    });
    await make("cara2", {
      total: "10.00",
      settledTotal: "10.00",
      inputUserId: CARA,
      completedUserId: CARA,
      enteredAt: at("2026-02-03", "10:00"),
      createdAt: at("2026-02-03", "10:00"),
      settledAt: at("2026-02-03", "10:01"),
    });
    await make("delivery", {
      total: "30.00",
      settledTotal: "30.00",
      fulfilmentMethod: "delivery",
      inputUserId: MIA,
      completedUserId: CODY,
      enteredAt: at("2026-02-04", "11:00"),
      createdAt: at("2026-02-04", "11:00"),
      outForDeliveryAt: at("2026-02-04", "11:30"),
      settledAt: at("2026-02-04", "12:00"),
    });
    await db.insert(orderItems).values([
      { orgId, orderId: orderIds.cara1, quantity: 2, unitPrice: "10.50", totalPrice: "21.00", unitCost: "6.00" },
      { orgId, orderId: orderIds.delivery, quantity: 1, unitPrice: "30.00", totalPrice: "30.00", unitCost: "15.00" },
    ]);
    await db.insert(orderEvents).values([
      { orgId, orderId: orderIds.cara1, kind: "ready", userId: CARA, at: at("2026-02-02", "11:10") },
      { orgId, orderId: orderIds.delivery, kind: "out_for_delivery", userId: MAX, at: at("2026-02-04", "11:30") },
      // Max deletes three orders this week; he usually deletes none.
      ...[1, 2, 3].map((n) => ({ orgId, orderId: randomUUID(), kind: "deleted", userId: MAX, at: at("2026-02-05", `1${n}:00`) })),
    ]);
    // Cody usually processes one refund a week; this week four.
    const refund = (day: string) => ({
      orderId: orderIds.delivery,
      orgId,
      cashierId: CODY,
      reason: "changed_mind",
      refundMethod: "card",
      total: "1.00",
      createdAt: at(day, "15:00"),
    });
    await db.insert(refunds).values([
      refund("2026-01-20"),
      refund("2026-01-27"),
      refund("2026-02-03"),
      refund("2026-02-04"),
      refund("2026-02-05"),
      refund("2026-02-06"),
    ]);
    const shift = (userId: string, day: string) => ({
      orgId,
      userId,
      tradingDay: day,
      openedByUserId: userId,
      openedAt: at(day, "09:00"),
      lastActivityAt: at(day, "12:50"),
      status: "closed",
    });
    await db.insert(cashierShifts).values([
      shift(CODY, "2026-01-20"),
      shift(CODY, "2026-01-27"),
      shift(CODY, "2026-02-03"),
      shift(MAX, "2026-01-21"),
      shift(MAX, "2026-01-28"),
      shift(MAX, "2026-02-05"),
      shift(CARA, "2026-02-02"),
      shift(CARA, "2026-02-03"),
      shift(MIA, "2026-02-04"),
    ] as never);
  });

  afterAll(async () => {
    if (!orgId) return;
    await db.delete(exceptionReviews).where(eq(exceptionReviews.orgId, orgId));
    await db.delete(orgNotifications).where(eq(orgNotifications.orgId, orgId));
    await db.delete(staffWeeklyRuns).where(eq(staffWeeklyRuns.orgId, orgId));
    await db.delete(dailyCloseRuns).where(eq(dailyCloseRuns.orgId, orgId));
    await db.delete(staffTargets).where(eq(staffTargets.orgId, orgId));
    await db.delete(adminAuditLogs).where(eq(adminAuditLogs.orgId, orgId));
    await db.delete(satisfactionScores).where(eq(satisfactionScores.orgId, orgId));
    await db.delete(refunds).where(eq(refunds.orgId, orgId));
    await db.delete(cashierShifts).where(eq(cashierShifts.orgId, orgId));
    await db.delete(orderEvents).where(eq(orderEvents.orgId, orgId));
    await db.delete(orderItems).where(eq(orderItems.orgId, orgId));
    await db.delete(orders).where(eq(orders.orgId, orgId));
    await db.delete(customers).where(eq(customers.orgId, orgId));
    await db.delete(allowedUsers).where(inArray(allowedUsers.replitUserId, [CARA, CODY, MIA, MAX, ADA]));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  const appAs = async (userId: string, role: string) => {
    const { registerStaffPerformanceRoutes } = await import("../routes/staffPerformance");
    const { registerReportCaptureRoutes } = await import("../routes/reportCapture");
    const scoped: RequestHandler = (req: any, _res, next) => {
      req.orgContext = { orgId, locationId: null, role };
      req.user = { id: userId, role };
      next();
    };
    const app = express();
    app.use(express.json());
    registerStaffPerformanceRoutes(app as never, [scoped]);
    registerReportCaptureRoutes(app as never, [scoped]);
    return app;
  };
  const q = `from=${WEEK.from}&to=${WEEK.to}`;

  it("Benefit (£) on the Evidence row: margin on the commission basis, Net benefit never called profit", async () => {
    const res = await request(await appAs(ADA, "ADMIN")).get(`/api/evidence/staff-performance?${q}`).expect(200);
    const cara = res.body.rows.find((r: { userId: string }) => r.userId === CARA);
    // 2 × (£10.50 − £6.00) = £9 margin before the £1 tier discount.
    expect(cara.benefit.marginContributed).toBe(9);
    expect(cara.benefit.discountGiven).toBe(1);
    expect(cara.benefit.netBenefit).toBe(8);
    expect(cara.benefit.namedCustomerCapturePercent).toBe(50);
    const mia = res.body.rows.find((r: { userId: string }) => r.userId === MIA);
    expect(mia.benefit.marginContributed).toBe(1.5); // 10% of Cody's £15
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain("profit");
    expect(cara.speed.collectionJudged).toBe(1);
    expect(cara.fairness.daysWorked).toBe(2);
    expect(cara.fairness.activeHours).toBe(8); // 2 × (3h50 + 10 min)
    expect(res.body.settingsInForce.now.prepSlaMinutes).toBeGreaterThan(0);
  });

  it("a cashier sees only My performance: own figures, no one else's, no cost — and Evidence is refused", async () => {
    const cara = await appAs(CARA, "CASHIER");
    await request(cara).get(`/api/evidence/staff-performance?${q}`).expect(403);
    await request(cara).get(`/api/evidence/order-timing?${q}`).expect(403);
    const res = await request(cara).get(`/api/my-performance?${q}`).expect(200);
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.body.person.name).toBe("Cara Cashier");
    expect(res.body.figures.completed).toBe(2);
    expect(res.body.includesToday).toBe(false);
    const text = JSON.stringify(res.body);
    for (const other of ["Cody", "Mia", "Max", "Ada", CODY, MIA]) expect(text).not.toContain(other);
    for (const costKey of ["marginContributed", "netBenefit", "unitCost", "costPrice", "discountGiven"]) expect(text).not.toContain(costKey);
    // Four people worked this week, so a team median is shown…
    expect(res.body.teamMedian?.people).toBe(4);
    // …but not on a day only Cara worked.
    const day = await request(cara).get(`/api/my-performance?from=2026-02-02&to=2026-02-02`).expect(200);
    expect(day.body.teamMedian).toBeNull();
  });

  it("setting a target changes the colours; only admins can, and each change is a new version", async () => {
    const admin = await appAs(ADA, "ADMIN");
    await request(await appAs(MIA, "MANAGER"))
      .put("/api/staff-targets")
      .send({ targets: [{ metric: "namedCustomerCapturePercent", green: 40, amber: 30, minData: 1 }] })
      .expect(403);
    await request(admin)
      .put("/api/staff-targets")
      .send({ targets: [{ metric: "namedCustomerCapturePercent", green: 40, amber: 30, minData: 1 }] })
      .expect(200);
    const colour = async () => {
      const res = await request(await appAs(CARA, "CASHIER")).get(`/api/my-performance?${q}`).expect(200);
      return res.body.kpis;
    };
    const first = await colour();
    expect(first.results[0].colour).toBe("green");
    expect(first.met).toBe(1);

    const v2 = await request(admin)
      .put("/api/staff-targets")
      .send({ targets: [{ metric: "namedCustomerCapturePercent", green: 80, amber: 60, minData: 1 }], note: "Raised" })
      .expect(200);
    expect(v2.body.version).toBe(2);
    const second = await colour();
    // 50% is below amber, but targets are new: the first 4 weeks are amber-only.
    expect(second.results[0].colour).toBe("amber");
    expect(second.amberOnly).toBe(true);
    expect(second.met).toBe(0);

    const read = await request(await appAs(CARA, "CASHIER")).get("/api/staff-targets").expect(200);
    expect(read.body.current.version).toBe(2);
    expect(read.body.canEdit).toBe(false);
    expect(read.body.history).toEqual([]);
    await expect(db.execute(sql`UPDATE staff_targets SET note = 'x' WHERE org_id = ${orgId}`)).rejects.toThrow();
    const audit = await db.select().from(adminAuditLogs).where(and(eq(adminAuditLogs.orgId, orgId), eq(adminAuditLogs.action, "staff_targets.set")));
    expect(audit).toHaveLength(2);
  });

  it("managers' digests contain no other managers' rows; a cashier's has no rows; admins see everyone", async () => {
    const { buildWeeklyDigest } = await import("../services/myPerformance");
    const mia = await buildWeeklyDigest(orgId, { userId: MIA, role: "MANAGER" }, WEEK);
    expect(mia.rows.map((r) => r.userId).sort()).toEqual([CARA, CODY].sort());
    expect(mia.own?.name).toBe("Mia Manager");
    const cara = await buildWeeklyDigest(orgId, { userId: CARA, role: "CASHIER" }, WEEK);
    expect(cara.rows).toEqual([]);
    expect(cara.own?.completed).toBe(2);
    const ada = await buildWeeklyDigest(orgId, { userId: ADA, role: "ADMIN" }, WEEK);
    expect(ada.rows.map((r) => r.userId).sort()).toEqual([CARA, CODY, MIA, MAX].sort());
    // The route builds the same for the caller, for a finished week only.
    const res = await request(await appAs(MIA, "MANAGER")).get(`/api/my-performance/digest?week=${WEEK.from}`).expect(200);
    expect(res.body.rows.map((r: { name: string }) => r.name)).not.toContain("Max Manager");
  });

  it("the weekly run raises flags into Needs a look, routed by role, once — and stores no named figures", async () => {
    const { runStaffWeekForOrg } = await import("../services/staffWeekly");
    // Not until Sunday's trading day has closed (Monday 06:00).
    expect(await runStaffWeekForOrg(orgId, WEEK)).toBeNull();
    await db.insert(dailyCloseRuns).values({ orgId, tradingDay: WEEK.to } as never);
    const run = await runStaffWeekForOrg(orgId, WEEK);
    expect(run?.flagsRaised).toBeGreaterThanOrEqual(2);
    expect(await runStaffWeekForOrg(orgId, WEEK)).toBeNull();

    const flags = await db.select().from(exceptionReviews).where(and(eq(exceptionReviews.orgId, orgId), eq(exceptionReviews.kind, "pattern")));
    const codyRefunds = flags.find((f) => f.subjectUserId === CODY && (f.rules as { metric: string }).metric === "refunds");
    expect(codyRefunds?.subjectRole).toBe("CASHIER");
    expect(codyRefunds?.summary).toContain("usually about 1 a week");
    const maxDeletes = flags.find((f) => f.subjectUserId === MAX && (f.rules as { metric: string }).metric === "deletes");
    expect(maxDeletes?.subjectRole).toBe("MANAGER");

    const { listNeedsALook } = await import("../services/exceptionReviews");
    const miaInbox = await listNeedsALook(orgId, { userId: MIA, role: "MANAGER" }, { kind: "pattern" });
    expect(miaInbox.items.some((i) => i.subjectUserId === CODY)).toBe(true);
    expect(miaInbox.items.some((i) => i.subjectUserId === MAX)).toBe(false);
    const adaInbox = await listNeedsALook(orgId, { userId: ADA, role: "ADMIN" }, { kind: "pattern" });
    expect(adaInbox.items.some((i) => i.subjectUserId === MAX)).toBe(true);
    const maxInbox = await listNeedsALook(orgId, { userId: MAX, role: "MANAGER" }, { kind: "pattern" });
    expect(maxInbox.items.some((i) => i.subjectUserId === MAX)).toBe(false);

    const digests = await db
      .select()
      .from(orgNotifications)
      .where(and(eq(orgNotifications.orgId, orgId), eq(orgNotifications.source, "staff_digest")));
    expect(digests).toHaveLength(1);
    const stored = JSON.stringify(digests[0]);
    for (const name of ["Cara", "Cody", "Mia", "Max", "£"]) expect(stored).not.toContain(name);
  });

  it("satisfaction: one rating per order, recording who rated and where", async () => {
    const cody = await appAs(CODY, "CASHIER");
    await request(cody).post("/api/satisfaction").send({ orderId: orderIds.cara1, score: 2 }).expect(201);
    await request(await appAs(CARA, "CASHIER")).post("/api/satisfaction").send({ orderId: orderIds.cara1, score: 5 }).expect(201);
    const rows = await db.select().from(satisfactionScores).where(eq(satisfactionScores.orderId, orderIds.cara1));
    expect(rows).toHaveLength(1);
    expect(rows[0].score).toBe(5);
    expect(rows[0].ratedByUserId).toBe(CARA);
    expect(rows[0].source).toBe("board");
    await expect(
      db.insert(satisfactionScores).values({ orgId, orderId: orderIds.cara1, score: 3 }),
    ).rejects.toThrow();
    // Information only: shown on My performance, never a KPI.
    const res = await request(await appAs(CARA, "CASHIER")).get(`/api/my-performance?${q}`).expect(200);
    expect(res.body.satisfaction).toEqual({ average: 5, count: 1 });
  });

  it("migration 171's duplicate clean-up keeps the follow-up already done on an older rating", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const file = readFileSync(path.resolve(__dirname, "../../migrations/171_staff_performance_7c.sql"), "utf8");
    const startAt = file.indexOf("WITH ranked AS");
    const endMarker = "(s.score_date, s.id) < (t.score_date, t.id);";
    const block = file.slice(startAt, file.indexOf(endMarker) + endMarker.length);
    expect(startAt).toBeGreaterThan(0);
    const o1 = randomUUID();
    const o2 = randomUUID();
    const rollback = new Error("rollback");
    let kept: Array<Record<string, unknown>> = [];
    await db
      .transaction(async (tx) => {
        // A temp table shadows the real one (which already has the one-per-order index).
        await tx.execute(sql.raw(`CREATE TEMP TABLE satisfaction_scores (id uuid, order_id uuid, score int, comment text, score_date timestamp, followed_up_at timestamp) ON COMMIT DROP`));
        await tx.execute(sql.raw(`INSERT INTO satisfaction_scores VALUES
          ('${randomUUID()}', '${o1}', 2, 'cold food', '2026-01-01', '2026-01-02'),
          ('${randomUUID()}', '${o1}', 1, NULL, '2026-01-03', NULL),
          ('${randomUUID()}', '${o2}', 4, NULL, '2026-01-03', NULL)`));
        for (const stmt of block.split(/;\s*\n/).map((x) => x.trim()).filter(Boolean)) await tx.execute(sql.raw(stmt));
        // Running it again changes nothing.
        for (const stmt of block.split(/;\s*\n/).map((x) => x.trim()).filter(Boolean)) await tx.execute(sql.raw(stmt));
        const res = await tx.execute(sql.raw(`SELECT order_id::text, score, comment, followed_up_at IS NOT NULL AS followed FROM satisfaction_scores ORDER BY score`));
        kept = ((res as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? (res as unknown as Array<Record<string, unknown>>));
        throw rollback;
      })
      .catch((e) => {
        if (e !== rollback) throw e;
      });
    expect(kept).toEqual([
      { order_id: o1, score: 1, comment: "cold food", followed: true },
      { order_id: o2, score: 4, comment: null, followed: false },
    ]);
  });
});
