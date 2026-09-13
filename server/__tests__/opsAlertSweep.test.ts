/**
 * Personal Operations Centre alerts — generation, resolution and the sweep,
 * against a real database (Phase N, N5a; docs/briefs/PHASE_N_OPERATIONS_CENTRE.md,
 * "Alerts & notifications"). This is the package's named `unit-db`
 * verification (its own DoD: "unit + `unit-db` (`opsAlertSweep`)").
 *
 * `sweepOpsAlerts` and `nextOpsAlertAt` are deliberately GLOBAL — the worker
 * runner has no org context (brief: "MIN over ... every org"), so every
 * assertion below that touches either function's counts filters by THIS
 * test's own `orderId`/`orgId` rather than trusting the function's aggregate
 * return value, which legitimately reflects every org's open orders on a
 * shared database (other suites' orgs, seed data). The two `nextOpsAlertAt`
 * cases go further and use a `<=` differential comparison for the same
 * reason: a concurrent suite's own near-future promise can only pull the
 * global minimum EARLIER than this test's own candidate, never hide it, so
 * `<=` is the strongest assertion that cannot flake on a shared box.
 *
 * Runs against a real database — excluded from the no-DB run in
 * vitest.config.ts, included in `unit-db` by explicit file name.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db";
import { opsAlerts, opsStaff, orderEvents, orders, organizations } from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";
import { runOrderTransition } from "../services/orderTransitions";
import { nextOpsAlertAt, sweepOpsAlerts } from "../services/opsAlerts";
import { computeNextWakeDelayMs } from "../workers";
import { subscribeOpsEvents, type OpsBusEntry } from "../services/opsBus";

const SUFFIX = Date.now().toString(36);
let orgId: string;

async function makeOrg(overrides: Partial<typeof organizations.$inferInsert> = {}) {
  const [org] = await db
    .insert(organizations)
    .values({ name: `ops-alert-sweep-${SUFFIX}-${Math.random().toString(36).slice(2, 8)}`, ...overrides })
    .returning();
  return org.id;
}

async function makeOrder(forOrgId: string, overrides: Partial<typeof orders.$inferInsert> = {}) {
  const [order] = await db
    .insert(orders)
    .values({ orgId: forOrgId, total: "15.00", paymentMethod: "cash", ...overrides })
    .returning();
  return order.id as string;
}

async function setStaff(forOrgId: string, userId: string, station: "collection" | "delivery" | "both", lastSeenAt: Date) {
  await db.insert(opsStaff).values({ orgId: forOrgId, userId, station, lastSeenAt, onBreak: false });
}

async function alertRows(forOrderId: string) {
  return db.select().from(opsAlerts).where(eq(opsAlerts.orderId, forOrderId));
}

const extraOrgIds: string[] = [];

beforeAll(async () => {
  orgId = await makeOrg();
});

afterAll(async () => {
  const allOrgIds = [orgId, ...extraOrgIds].filter(Boolean);
  // Each org cleaned up independently: on a shared database, one org hitting
  // a transient error (a dropped connection, a concurrent suite's own
  // in-flight write) must not leave every OTHER org this run created behind
  // too — the accumulation this guards against is exactly what makes
  // `resolveOrgId()`'s "first org from /api/orgs" journey fixture fragile in
  // the first place (see the file's own header).
  for (const id of allOrgIds) {
    try {
      const orderRows = await db.select({ id: orders.id }).from(orders).where(eq(orders.orgId, id));
      const orderIds = orderRows.map((o) => o.id);
      for (const oid of orderIds) {
        await db.delete(opsAlerts).where(eq(opsAlerts.orderId, oid));
      }
      await db.delete(orderEvents).where(eq(orderEvents.orgId, id));
      await db.delete(opsStaff).where(eq(opsStaff.orgId, id));
      await db.delete(orders).where(eq(orders.orgId, id));
      await db.delete(organizations).where(eq(organizations.id, id));
    } catch (error) {
      console.error(`[opsAlertSweep.test] Cleanup failed for org ${id}:`, error);
    }
  }
});

describe("transactional alerts (createInTx via orderTransitions.ts)", () => {
  it("an assignment creates one row, for the assignee only — not the actor doing the assigning", async () => {
    const orderId = await makeOrder(orgId, { fulfilmentMethod: "collection" });
    await runOrderTransition({
      orgId,
      orderId,
      actor: { userId: "manager-1", role: "MANAGER" },
      input: { action: "assign", userId: "sam" },
    });

    const rows = await alertRows(orderId);
    const assigned = rows.filter((r) => r.kind === "assigned");
    expect(assigned).toHaveLength(1);
    expect(assigned[0].userId).toBe("sam");
    expect(assigned.some((r) => r.userId === "manager-1")).toBe(false);
  });

  it("a self-claim writes NO `assigned` alert (brief: 'not on self-claim')", async () => {
    const orderId = await makeOrder(orgId, { fulfilmentMethod: "collection" });
    await runOrderTransition({
      orgId,
      orderId,
      actor: { userId: "sam", role: "CASHIER" },
      input: { action: "claim" },
    });
    const rows = await alertRows(orderId);
    expect(rows.filter((r) => r.kind === "assigned")).toHaveLength(0);
  });

  it("a colleague's claim resolves everyone ELSE's station rows — never the new assignee's own", async () => {
    const localOrgId = await makeOrg({ opsDueSoonLeadMinutes: 10, opsLateGraceMinutes: 5 });
    extraOrgIds.push(localOrgId);
    const now = new Date();
    await setStaff(localOrgId, "sam", "collection", now);
    await setStaff(localOrgId, "kim", "collection", now);

    // due_soon fires when dueEffective - lead <= now; a promise 3 minutes
    // away with a 10-minute lead is already inside that window. Received 30
    // minutes ago so the promise-received window (33 min) clears the
    // "skipped when promise − received ≤ lead + 2 min" carve-out.
    const orderId = await makeOrder(localOrgId, {
      fulfilmentMethod: "collection",
      enteredAt: new Date(now.getTime() - 30 * 60_000),
      revisedEta: new Date(now.getTime() + 3 * 60_000),
    });
    await sweepOpsAlerts(now);

    const before = await alertRows(orderId);
    const dueSoonBefore = before.filter((r) => r.kind === "due_soon");
    expect(dueSoonBefore.map((r) => r.userId).sort()).toEqual(["kim", "sam"]);
    expect(dueSoonBefore.every((r) => r.station === "collection")).toBe(true);

    await runOrderTransition({
      orgId: localOrgId,
      orderId,
      actor: { userId: "kim", role: "CASHIER" },
      input: { action: "claim" },
    });

    const after = await alertRows(orderId);
    const samRow = after.find((r) => r.kind === "due_soon" && r.userId === "sam");
    const kimRow = after.find((r) => r.kind === "due_soon" && r.userId === "kim");
    expect(samRow?.resolvedAt).not.toBeNull();
    expect(samRow?.resolvedReason).toBe("claimed");
    // "for everyone BUT the new assignee" — kim's own prior row is untouched.
    expect(kimRow?.resolvedAt).toBeNull();
  });

  it("complete resolves every open alert on the order", async () => {
    const localOrgId = await makeOrg({ opsDueSoonLeadMinutes: 10, opsLateGraceMinutes: 5 });
    extraOrgIds.push(localOrgId);
    const now = new Date();
    const orderId = await makeOrder(localOrgId, {
      fulfilmentMethod: "collection",
      assignedUserId: "sam",
      enteredAt: new Date(now.getTime() - 30 * 60_000),
      revisedEta: new Date(now.getTime() + 3 * 60_000),
    });
    await sweepOpsAlerts(now);
    const before = await alertRows(orderId);
    expect(before.filter((r) => r.kind === "due_soon" && r.resolvedAt === null).length).toBeGreaterThan(0);

    await runOrderTransition({
      orgId: localOrgId,
      orderId,
      actor: { userId: "sam", role: "CASHIER" },
      input: { action: "complete" },
    });

    const after = await alertRows(orderId);
    expect(after.every((r) => r.resolvedAt !== null)).toBe(true);
    expect(after.every((r) => r.resolvedReason === "completed")).toBe(true);
  });
});

describe("sweepOpsAlerts — time-based generation", () => {
  it("T-minus-lead and late each fire exactly once, even across two independent sweep calls (a restart re-runs from nothing)", async () => {
    const localOrgId = await makeOrg({ opsDueSoonLeadMinutes: 10, opsLateGraceMinutes: 5 });
    extraOrgIds.push(localOrgId);
    const now = new Date();
    // Received 40 minutes ago, promised 20 minutes ago: due_soon
    // (dueEffective-10) and late (dueEffective+5) are both already in the
    // past relative to `now`, and the 20-minute promise-received window
    // clears the "skipped when ≤ lead + 2 min" carve-out.
    const orderId = await makeOrder(localOrgId, {
      fulfilmentMethod: "collection",
      assignedUserId: "sam",
      enteredAt: new Date(now.getTime() - 40 * 60_000),
      revisedEta: new Date(now.getTime() - 20 * 60_000),
    });

    await sweepOpsAlerts(now);
    await sweepOpsAlerts(now); // simulates a restart: no in-process memory carries over

    const rows = await alertRows(orderId);
    expect(rows.filter((r) => r.kind === "due_soon")).toHaveLength(1);
    expect(rows.filter((r) => r.kind === "late")).toHaveLength(1);
    expect(rows.filter((r) => r.kind === "due_soon")[0].userId).toBe("sam");
    expect(rows.filter((r) => r.kind === "late")[0].userId).toBe("sam");
  });

  it("no rows for an SLA-derived due date when the org has not opted in (default off)", async () => {
    const localOrgId = await makeOrg(); // ops_alert_on_sla_due defaults to false
    extraOrgIds.push(localOrgId);
    const now = new Date();
    const orderId = await makeOrder(localOrgId, {
      fulfilmentMethod: "collection",
      enteredAt: new Date(now.getTime() - 3 * 60 * 60_000), // 3 hours old — very "overdue" under the SLA fallback
      etaGiven: null,
      revisedEta: null,
    });

    await sweepOpsAlerts(now);

    const rows = await alertRows(orderId);
    expect(rows.filter((r) => r.kind === "due_soon" || r.kind === "late")).toHaveLength(0);
  });

  it("the SAME order DOES get a late alert once the org opts into SLA-derived dues", async () => {
    const localOrgId = await makeOrg({ opsAlertOnSlaDue: true, opsPrepSlaMinutes: 20, opsLateGraceMinutes: 5 });
    extraOrgIds.push(localOrgId);
    const now = new Date();
    const orderId = await makeOrder(localOrgId, {
      fulfilmentMethod: "collection",
      assignedUserId: "sam",
      enteredAt: new Date(now.getTime() - 60 * 60_000), // way past prep(20)+grace(5)
      etaGiven: null,
      revisedEta: null,
    });

    await sweepOpsAlerts(now);

    const rows = await alertRows(orderId);
    const late = rows.filter((r) => r.kind === "late");
    expect(late).toHaveLength(1);
    expect(late[0].userId).toBe("sam");
    // due_soon is "promise only" (brief) — never generated from the SLA fallback.
    expect(rows.filter((r) => r.kind === "due_soon")).toHaveLength(0);
  });

  it("a completed order's alert rows are resolved even when completion bypassed the transition endpoint (defensive net)", async () => {
    const localOrgId = await makeOrg({ opsDueSoonLeadMinutes: 10, opsLateGraceMinutes: 5 });
    extraOrgIds.push(localOrgId);
    const now = new Date();
    const orderId = await makeOrder(localOrgId, {
      fulfilmentMethod: "collection",
      assignedUserId: "sam",
      revisedEta: new Date(now.getTime() - 20 * 60_000),
    });
    await sweepOpsAlerts(now);
    expect((await alertRows(orderId)).length).toBeGreaterThan(0);

    // Simulate a completion made through a path other than
    // POST …/transition (e.g. the legacy PATCH /api/orders/:id), which this
    // package does not touch — orders.ts is outside N5a's file list.
    await db.update(orders).set({ status: "completed" }).where(eq(orders.id, orderId));

    await sweepOpsAlerts(now);

    const rows = await alertRows(orderId);
    expect(rows.every((r) => r.resolvedAt !== null && r.resolvedReason === "completed")).toBe(true);
  });

  it("a carried-over order's rows are resolved, and it gets no fresh alerts", async () => {
    const localOrgId = await makeOrg({ timezone: "UTC" });
    extraOrgIds.push(localOrgId);
    // Comfortably after 06:00 UTC today.
    const now = new Date();
    now.setUTCHours(12, 0, 0, 0);
    const yesterdayMorning = new Date(now.getTime() - 26 * 60 * 60_000); // clearly the prior trading day
    const orderId = await makeOrder(localOrgId, {
      fulfilmentMethod: "collection",
      dateKind: "live",
      enteredAt: yesterdayMorning,
      createdAt: yesterdayMorning,
    });
    // A pre-existing, unresolved row as if it fired yesterday, before the roll-over.
    await db.insert(opsAlerts).values({
      orgId: localOrgId,
      orderId,
      userId: "sam",
      station: "collection",
      kind: "new_unassigned",
      dueKey: yesterdayMorning.toISOString(),
    });

    await sweepOpsAlerts(now);

    const rows = await alertRows(orderId);
    expect(rows).toHaveLength(1); // no fresh new_unassigned generated for a carried-over order
    expect(rows[0].resolvedAt).not.toBeNull();
    expect(rows[0].resolvedReason).toBe("rolled_over");
  });

  it("new_unassigned: fires 60s after receipt, skipped for 5 minutes while the loader is present", async () => {
    const localOrgId = await makeOrg();
    extraOrgIds.push(localOrgId);
    const now = new Date();
    await setStaff(localOrgId, "ravi", "collection", now);
    await setStaff(localOrgId, "ana", "collection", now); // the loader, present

    const skipped = await makeOrder(localOrgId, {
      fulfilmentMethod: "collection",
      inputUserId: "ana",
      enteredAt: new Date(now.getTime() - 2 * 60_000), // 2 min old, loader present -> still skipped (< 5 min)
    });
    const due = await makeOrder(localOrgId, {
      fulfilmentMethod: "collection",
      inputUserId: "ana",
      enteredAt: new Date(now.getTime() - 6 * 60_000), // past the 5-minute loader-present grace
    });

    await sweepOpsAlerts(now);

    expect((await alertRows(skipped)).filter((r) => r.kind === "new_unassigned")).toHaveLength(0);
    const dueRows = (await alertRows(due)).filter((r) => r.kind === "new_unassigned");
    expect(dueRows.map((r) => r.userId).sort()).toEqual(["ana", "ravi"]);
  });
});

/**
 * Adversarial-review gap fix (found against PR #197, "alert rail, pulse,
 * chime and announcer (N5b)"): every alert-creating path here wrote its
 * `ops_alerts` row and stopped — nothing ever called `publishOpsEvent`, so a
 * fresh alert had NO live-push path at all and could only ever reach an
 * already-open board on the next ~60s reconciliation poll, against the
 * brief's own "real 9-min promise → alert ≤ 25s" DoD. These tests subscribe
 * to the real, in-process `opsBus` (the same mechanism `opsStream.test.ts`
 * uses for the "order" event) rather than mocking anything, so a passing test
 * here proves the actual production call path pushes the event — not merely
 * that a hand-built one would be accepted.
 */
describe("opsBus push wiring (N5b gap fix)", () => {
  it("an assignment publishes { type: 'alert' } after commit, shaped like a poll's own row plus userId", async () => {
    const orderId = await makeOrder(orgId, { fulfilmentMethod: "collection" });
    const events: OpsBusEntry[] = [];
    const unsubscribe = subscribeOpsEvents(orgId, (entry) => events.push(entry));
    try {
      await runOrderTransition({
        orgId,
        orderId,
        actor: { userId: "manager-1", role: "MANAGER" },
        input: { action: "assign", userId: "sam" },
      });
    } finally {
      unsubscribe();
    }

    const alertEvents = events.filter(
      (e): e is OpsBusEntry & { event: { type: "alert"; alert: any } } => e.event.type === "alert",
    );
    expect(alertEvents).toHaveLength(1);
    const pushed = alertEvents[0].event.alert;
    expect(pushed.userId).toBe("sam");
    expect(pushed.orderId).toBe(orderId);
    expect(pushed.kind).toBe("assigned");
    // Same row a poll of GET /api/orders/board would return for "sam"
    // (server/services/opsAlerts.ts's OpsAlertListItem) — id, orderId, kind,
    // station, dueAt, createdAt — plus the userId a broadcast needs to route
    // that a scoped poll response never carries. No `orgId` on the wire: that
    // is only the opsBus routing key (this event arrived on org's own
    // subscription), never part of the payload itself.
    expect(Object.keys(pushed).sort()).toEqual(
      ["id", "orderId", "userId", "kind", "station", "dueAt", "createdAt"].sort(),
    );
    expect(typeof pushed.id).toBe("string");
    expect(typeof pushed.createdAt).toBe("string");

    // Published strictly AFTER commit, not from inside the transaction: the
    // row this event describes must already be readable in the database by
    // the time the event exists.
    const rows = await alertRows(orderId);
    expect(rows.some((r) => r.id === pushed.id)).toBe(true);
  });

  it("a self-claim (no `assigned` alert at all — brief: 'not on self-claim') publishes no alert event", async () => {
    const orderId = await makeOrder(orgId, { fulfilmentMethod: "collection" });
    const events: OpsBusEntry[] = [];
    const unsubscribe = subscribeOpsEvents(orgId, (entry) => events.push(entry));
    try {
      await runOrderTransition({
        orgId,
        orderId,
        actor: { userId: "sam", role: "CASHIER" },
        input: { action: "claim" },
      });
    } finally {
      unsubscribe();
    }
    expect(events.some((e) => e.event.type === "alert")).toBe(false);
  });

  it("resolveOpsAlertsForTransition publishes no alert event of its own — resolution is not in the brief's push list", async () => {
    const localOrgId = await makeOrg({ opsDueSoonLeadMinutes: 10, opsLateGraceMinutes: 5 });
    extraOrgIds.push(localOrgId);
    const now = new Date();
    await setStaff(localOrgId, "sam", "collection", now);
    await setStaff(localOrgId, "kim", "collection", now);
    const orderId = await makeOrder(localOrgId, {
      fulfilmentMethod: "collection",
      enteredAt: new Date(now.getTime() - 30 * 60_000),
      revisedEta: new Date(now.getTime() + 3 * 60_000),
    });
    await sweepOpsAlerts(now); // creates sam's and kim's due_soon rows (sweepOpsAlerts's own publish, asserted separately below)

    const events: OpsBusEntry[] = [];
    const unsubscribe = subscribeOpsEvents(localOrgId, (entry) => events.push(entry));
    try {
      // A self-claim: `shouldAlertAssigned` silences the `assigned` alert
      // entirely (asserted above), so the ONLY alert-shaped thing this
      // transition does is RESOLVE — kim's own and sam's now-stale
      // `due_soon` rows via `resolveOpsAlertsForTransition`. Zero alert
      // events must be published for that resolution.
      await runOrderTransition({
        orgId: localOrgId,
        orderId,
        actor: { userId: "kim", role: "CASHIER" },
        input: { action: "claim" },
      });
    } finally {
      unsubscribe();
    }

    expect(events.filter((e) => e.event.type === "alert")).toHaveLength(0);
    // Confirm the resolution genuinely happened — this is not a vacuous "no
    // alert events because nothing happened" pass.
    const rows = await alertRows(orderId);
    const samRow = rows.find((r) => r.kind === "due_soon" && r.userId === "sam");
    expect(samRow?.resolvedAt).not.toBeNull();
  });

  it("an illegal transition that throws and rolls back publishes NO alert event — never a phantom push for a row that was never committed", async () => {
    const orderId = await makeOrder(orgId, { fulfilmentMethod: "collection" });
    // First assignment succeeds and legitimately publishes.
    await runOrderTransition({
      orgId,
      orderId,
      actor: { userId: "manager-1", role: "MANAGER" },
      input: { action: "assign", userId: "sam" },
    });

    const events: OpsBusEntry[] = [];
    const unsubscribe = subscribeOpsEvents(orgId, (entry) => events.push(entry));
    try {
      // "ready" with no due-date/state issue is legal; force an illegal one
      // instead — completing an order that has no `ready_at`/appropriate
      // state for "out_for_delivery" on a collection order is refused by
      // `assertTransition` (N0) before any write happens.
      await expect(
        runOrderTransition({
          orgId,
          orderId,
          actor: { userId: "sam", role: "CASHIER" },
          input: { action: "out_for_delivery" },
        }),
      ).rejects.toThrow();
    } finally {
      unsubscribe();
    }

    expect(events).toHaveLength(0);
  });

  it("sweepOpsAlerts publishes one alert event per row it actually inserts (due_soon, time-based)", async () => {
    const localOrgId = await makeOrg({ opsDueSoonLeadMinutes: 10, opsLateGraceMinutes: 5 });
    extraOrgIds.push(localOrgId);
    const now = new Date();
    await setStaff(localOrgId, "sam", "collection", now);
    // Assigned to sam already: an unassigned order this old would ALSO earn
    // its own `new_unassigned` alert (and event), which is real but not what
    // this test is isolating.
    await makeOrder(localOrgId, {
      fulfilmentMethod: "collection",
      assignedUserId: "sam",
      enteredAt: new Date(now.getTime() - 30 * 60_000),
      revisedEta: new Date(now.getTime() + 3 * 60_000),
    });

    const events: OpsBusEntry[] = [];
    const unsubscribe = subscribeOpsEvents(localOrgId, (entry) => events.push(entry));
    try {
      await sweepOpsAlerts(now);
    } finally {
      unsubscribe();
    }

    const alertEvents = events.filter((e) => e.event.type === "alert");
    expect(alertEvents.length).toBeGreaterThan(0);
    expect(alertEvents.every((e) => (e.event as { alert: any }).alert.kind === "due_soon")).toBe(true);
    expect(alertEvents.every((e) => (e.event as { alert: any }).alert.userId === "sam")).toBe(true);

    // A second sweep at the same instant finds its own rows already written
    // (ON CONFLICT DO NOTHING) and must not re-publish them.
    const events2: OpsBusEntry[] = [];
    const unsubscribe2 = subscribeOpsEvents(localOrgId, (entry) => events2.push(entry));
    try {
      await sweepOpsAlerts(now);
    } finally {
      unsubscribe2();
    }
    expect(events2.filter((e) => e.event.type === "alert")).toHaveLength(0);
  });
});

describe("nextOpsAlertAt / the precise wake", () => {
  it("computeNextWakeDelayMs schedules within 2s of an injected next-alert instant (the DoD, proved without a real timer)", () => {
    const now = Date.now();
    const nextAlertAt = new Date(now + 5 * 60_000); // 5 real minutes away, injected — no waiting
    const delay = computeNextWakeDelayMs({
      now,
      idleDelayMs: 15 * 60_000, // the idle ceiling, much later than the alert
      activeBaseMs: 250,
      nextQueuedRunAt: null,
      nextOpsAlertAt: nextAlertAt,
    });
    const scheduledFor = now + delay;
    expect(Math.abs(scheduledFor - nextAlertAt.getTime())).toBeLessThanOrEqual(2_000);
  });

  it("computeNextWakeDelayMs takes whichever of the two candidates is sooner", () => {
    const now = Date.now();
    const soonAlert = new Date(now + 30_000);
    const laterJob = new Date(now + 5 * 60_000);
    const delay = computeNextWakeDelayMs({
      now,
      idleDelayMs: 15 * 60_000,
      activeBaseMs: 250,
      nextQueuedRunAt: laterJob,
      nextOpsAlertAt: soonAlert,
    });
    expect(Math.abs(now + delay - soonAlert.getTime())).toBeLessThanOrEqual(2_000);
  });

  it("never returns an instant already in the past — that tick's own sweep already handled it", () => {
    const now = Date.now();
    const delay = computeNextWakeDelayMs({
      now,
      idleDelayMs: 60_000,
      activeBaseMs: 250,
      nextQueuedRunAt: null,
      nextOpsAlertAt: new Date(now - 60_000), // already due
    });
    expect(delay).toBe(0);
  });

  it("nextOpsAlertAt(now) finds a newly-seeded future promise: the global minimum can only be at or before it", async () => {
    const localOrgId = await makeOrg({ opsDueSoonLeadMinutes: 10, opsLateGraceMinutes: 5 });
    extraOrgIds.push(localOrgId);
    const now = new Date();
    const dueAt = new Date(now.getTime() + 20 * 60_000);
    await makeOrder(localOrgId, { fulfilmentMethod: "collection", revisedEta: dueAt });
    const myDueSoonCandidate = new Date(dueAt.getTime() - 10 * 60_000); // now + 10 min

    const result = await nextOpsAlertAt(now);

    expect(result).not.toBeNull();
    expect((result as Date).getTime()).toBeGreaterThan(now.getTime());
    // A concurrent suite's own order can only pull the GLOBAL minimum earlier
    // than this one candidate, never hide it — so `<=` is the strongest
    // assertion that holds on a shared database (see the file's own header).
    expect((result as Date).getTime()).toBeLessThanOrEqual(myDueSoonCandidate.getTime());
  });

  it("excludes a backdated order from due_soon/late generation even though its promise has long passed", async () => {
    const localOrgId = await makeOrg({ opsDueSoonLeadMinutes: 10, opsLateGraceMinutes: 5 });
    extraOrgIds.push(localOrgId);
    const now = new Date();
    const orderId = await makeOrder(localOrgId, {
      fulfilmentMethod: "collection",
      dateKind: "backdated",
      assignedUserId: "sam",
      revisedEta: new Date(now.getTime() - 60 * 60_000),
    });

    await sweepOpsAlerts(now);

    expect(await alertRows(orderId)).toHaveLength(0);
  });
});
