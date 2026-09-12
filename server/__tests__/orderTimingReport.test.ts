/**
 * ARC-T2-005 Order Timing & Service Levels — the "engine" half, against a
 * real database (Phase N, N7 "maths + engine" round;
 * docs/briefs/PHASE_N_OPERATIONS_CENTRE.md, "Reporting"). The maths itself
 * (`shared/reports/orderTiming.ts`) is unit-tested on fixtures alone; this
 * proves `server/services/reportsEngine.ts`'s `orderTimingReport` assembles
 * the right `TimingOrderInput` rows from real `orders` + `order_events` rows
 * — in particular the one correctness note N3b's own adversarial review
 * raised for whoever built this: a resettled order (reopened, then
 * re-completed) writes a SECOND `order_events` row with `kind:'completed'`
 * and `meta.resettled:true`, and must be counted once, not twice.
 *
 * Also covers `delayLog`'s N7 re-sourcing (DoD: "Delay Log shows a cleared
 * delay") — there is no separate DB-suite file for it in N8's `unit-db` file
 * list (that list is by explicit name; adding a file is `.github/workflows/
 * ci.yml`, outside this package's touch list), so its regression coverage
 * lives here, in the one N7 DB-suite file CI already runs by name, rather
 * than in an untested file CI would silently skip.
 *
 * Runs against a real database — excluded from the no-DB run in
 * vitest.config.ts, included in `unit-db` by explicit file name.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db";
import { orderEvents, orders, opsStaff, organizations } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { orderTimingReport, delayLog } from "../services/reportsEngine";
import { runOrderTransition } from "../services/orderTransitions";

const SUFFIX = Date.now().toString(36);
let orgId: string;

const FAR_PAST = new Date("2000-01-01T00:00:00.000Z");
const FAR_FUTURE = new Date("2100-01-01T00:00:00.000Z");

beforeAll(async () => {
  const [org] = await db.insert(organizations).values({ name: `order-timing-report-${SUFFIX}` }).returning();
  orgId = org.id;
});

afterAll(async () => {
  if (!orgId) return;
  await db.delete(orderEvents).where(eq(orderEvents.orgId, orgId));
  await db.delete(opsStaff).where(eq(opsStaff.orgId, orgId));
  await db.delete(orders).where(eq(orders.orgId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
});

type OrderOverrides = Partial<typeof orders.$inferInsert>;

async function makeOrder(overrides: OrderOverrides = {}): Promise<string> {
  const [order] = await db
    .insert(orders)
    .values({ orgId, total: "15.00", paymentMethod: "cash", ...overrides })
    .returning();
  return order.id;
}

async function findRow(rows: Record<string, unknown>[], orderId: string) {
  return rows.find((r) => r.orderId === orderId.slice(0, 8));
}

describe("orderTimingReport — seeded stamps produce exact figures", () => {
  it("a collection order ready before its promise is on time; one that missed it is late", async () => {
    const receivedAt = new Date("2026-06-01T09:00:00.000Z");
    const onTimeOrder = await makeOrder({
      fulfilmentMethod: "collection",
      status: "completed",
      enteredAt: receivedAt,
      createdAt: receivedAt,
      etaGiven: new Date("2026-06-01T09:30:00.000Z"),
      readyAt: new Date("2026-06-01T09:20:00.000Z"), // 10 min before the promise
      settledAt: new Date("2026-06-01T09:45:00.000Z"),
    });
    const lateOrder = await makeOrder({
      fulfilmentMethod: "collection",
      status: "completed",
      enteredAt: receivedAt,
      createdAt: receivedAt,
      etaGiven: new Date("2026-06-01T09:30:00.000Z"),
      readyAt: new Date("2026-06-01T09:40:00.000Z"), // 10 min after the promise
      settledAt: new Date("2026-06-01T09:50:00.000Z"),
    });

    const report = await orderTimingReport(orgId, new Date("2026-06-01T00:00:00.000Z"), new Date("2026-06-01T23:59:59.000Z"));

    const onTimeRow = await findRow(report.rows, onTimeOrder);
    const lateRow = await findRow(report.rows, lateOrder);
    expect(onTimeRow?.onTime).toBe(true);
    expect(onTimeRow?.receivedToReadyMinutes).toBeCloseTo(20, 5);
    expect(lateRow?.onTime).toBe(false);
    expect(lateRow?.latenessMinutes).toBeCloseTo(10, 5);

    expect(report.summary.collectionOnTimePercent).toBeCloseTo(50, 5);
  });

  it("a delivery order is judged at handover, not at ready", async () => {
    const receivedAt = new Date("2026-06-02T12:00:00.000Z");
    const orderId = await makeOrder({
      fulfilmentMethod: "delivery",
      status: "completed",
      enteredAt: receivedAt,
      createdAt: receivedAt,
      etaGiven: new Date("2026-06-02T13:00:00.000Z"),
      readyAt: new Date("2026-06-02T13:10:00.000Z"), // "late" if judged here
      outForDeliveryAt: new Date("2026-06-02T13:15:00.000Z"),
      settledAt: new Date("2026-06-02T12:55:00.000Z"), // but delivered before the promise
    });

    const report = await orderTimingReport(orgId, new Date("2026-06-02T00:00:00.000Z"), new Date("2026-06-02T23:59:59.000Z"));
    const row = await findRow(report.rows, orderId);
    expect(row?.onTime).toBe(true);
    expect(row?.dispatchToDeliveredMinutes).toBeCloseTo(-20, 5); // settled BEFORE dispatch stamp in this fixture — a negative gap is still exact arithmetic
  });
});

describe("orderTimingReport — a resettled order is counted once, not twice", () => {
  it("reopen + re-complete writes two 'completed' events but ONE report row, using the final settlement", async () => {
    const orderId = await makeOrder({ status: "pending", total: "20.00" });
    const actor = { userId: `sam-${SUFFIX}`, role: "MANAGER" };

    const first = await runOrderTransition({ orgId, orderId, actor, input: { action: "complete" } });
    expect(first.order.status).toBe("completed");

    await runOrderTransition({ orgId, orderId, actor, input: { action: "reopen" } });

    // Change the total before re-completing so the two settlements are
    // genuinely distinguishable, not just two identical writes.
    await db.update(orders).set({ total: "35.00" }).where(eq(orders.id, orderId));
    const second = await runOrderTransition({ orgId, orderId, actor, input: { action: "complete" } });
    expect(second.order.status).toBe("completed");
    expect(second.order.total).toBe("35.00");

    // Prove the fixture really did write two `completed` events, one of them
    // `meta.resettled: true` — otherwise this test would not be exercising
    // the thing it claims to.
    const completedEvents = await db
      .select({ meta: orderEvents.meta })
      .from(orderEvents)
      .where(and(eq(orderEvents.orgId, orgId), eq(orderEvents.orderId, orderId), eq(orderEvents.kind, "completed")));
    expect(completedEvents).toHaveLength(2);
    expect(completedEvents.some((e) => (e.meta as { resettled?: boolean } | null)?.resettled === true)).toBe(true);

    const report = await orderTimingReport(orgId, FAR_PAST, FAR_FUTURE);
    const matchingRows = report.rows.filter((r) => r.orderId === orderId.slice(0, 8));
    expect(matchingRows).toHaveLength(1); // not two — the whole point of this test
    expect(matchingRows[0]?.excluded).toBeNull();

    // The order's OWN row (not the events table) is the source of truth this
    // report reads, and it was rewritten to the SECOND settlement in place —
    // so the report sees the final total's order once, not the stale first one.
    const [row] = await db.select({ settledTotal: orders.settledTotal }).from(orders).where(eq(orders.id, orderId));
    expect(row.settledTotal).toBe("35.00");
  });

  it("a driver-reported actualAt on the FIRST completion must not survive a reopen + ordinary re-complete", async () => {
    // Adversarial-review repro: the first completion carries a driver-reported
    // `actualAt` (a real feature — Q7 owner answer). The order is then
    // reopened and re-completed NORMALLY (no actualAt supplied on the second
    // completion — the ordinary case). The handover-map dedupe must not keep
    // using the stale, superseded actualAt from the first completion — it
    // must fall through to the CURRENT `orders.settledAt` once the final
    // completion event in `at` order carries no override of its own.
    const enteredAt = new Date("2026-06-15T09:00:00.000Z");
    const orderId = await makeOrder({
      fulfilmentMethod: "delivery",
      status: "pending",
      enteredAt,
      createdAt: enteredAt,
      etaGiven: new Date("2026-06-15T09:30:00.000Z"),
    });
    const actor = { userId: `dana-${SUFFIX}`, role: "MANAGER" };

    // First completion: driver-reported actualAt just 10 minutes after
    // enteredAt (comfortably on time) — this is the value the bug
    // incorrectly keeps forever.
    await runOrderTransition({
      orgId,
      orderId,
      actor,
      input: { action: "complete", actualAt: "2026-06-15T09:10:00.000Z" },
    });

    await runOrderTransition({ orgId, orderId, actor, input: { action: "reopen" } });

    // Second completion: the ordinary case — no actualAt override, so it
    // writes a `completed` event whose `meta` carries no `actualAt` at all.
    const second = await runOrderTransition({ orgId, orderId, actor, input: { action: "complete" } });
    expect(second.order.status).toBe("completed");

    // Pin the real settlement to a deterministic, LATE instant on the same
    // trading day (avoiding a real "months later" re-complete, which would
    // land on a different trading day and get excluded as carried-over
    // instead of exercising the onTime judgement this test is about) — the
    // same fixture-patching technique the resettle test above uses for
    // `orders.total`.
    const currentSettledAt = new Date("2026-06-15T10:30:00.000Z"); // 90 min after enteredAt, 60 min past the 09:30 promise
    await db.update(orders).set({ settledAt: currentSettledAt }).where(eq(orders.id, orderId));

    // Prove the fixture really did write two `completed` events, and that
    // the SECOND (current) one carries no `actualAt` — otherwise this test
    // would not be exercising the bug's exact trigger.
    const completedEvents = await db
      .select({ at: orderEvents.at, meta: orderEvents.meta })
      .from(orderEvents)
      .where(and(eq(orderEvents.orgId, orgId), eq(orderEvents.orderId, orderId), eq(orderEvents.kind, "completed")))
      .orderBy(orderEvents.at);
    expect(completedEvents).toHaveLength(2);
    expect((completedEvents[0]?.meta as { actualAt?: string } | null)?.actualAt).toBe("2026-06-15T09:10:00.000Z");
    expect((completedEvents[1]?.meta as { actualAt?: string } | null)?.actualAt).toBeUndefined();

    const report = await orderTimingReport(orgId, FAR_PAST, FAR_FUTURE);
    const row = await findRow(report.rows, orderId);
    expect(row).toBeDefined();
    expect(row?.excluded).toBeNull();

    // The stale-bug value would be exactly 10 minutes and onTime:true (judged
    // against the superseded first completion). The CURRENT settlement is 90
    // minutes after enteredAt and 60 minutes past the 09:30 promise.
    expect(row?.receivedToCompletedMinutes).not.toBeCloseTo(10, 5);
    expect(row?.receivedToCompletedMinutes).toBeCloseTo(90, 5);
    expect(row?.onTime).toBe(false);
  });
});

describe("orderTimingReport — exclusions", () => {
  it("excludes a ready event stamped by migration 065's backfill (meta.assumed:true)", async () => {
    const receivedAt = new Date("2026-06-03T08:00:00.000Z");
    const orderId = await makeOrder({
      status: "awaiting-customer",
      fulfilmentMethod: "collection",
      enteredAt: receivedAt,
      createdAt: receivedAt,
      readyAt: new Date("2026-06-03T09:00:00.000Z"),
    });
    await db.insert(orderEvents).values({
      orgId,
      orderId,
      kind: "ready",
      at: new Date("2026-06-03T09:00:00.000Z"),
      userId: null,
      meta: { assumed: true },
    });

    const report = await orderTimingReport(orgId, new Date("2026-06-03T00:00:00.000Z"), new Date("2026-06-03T23:59:59.000Z"));
    const row = await findRow(report.rows, orderId);
    expect(row?.excluded).toBe("assumed-ready");
  });

  it("excludes a carried-over completion — received on one trading day, settled on the next", async () => {
    // Received 05:50 on the 9th (before the 06:00 cut, so trading day 8th);
    // settled 08:00 on the 9th (trading day 9th).
    const orderId = await makeOrder({
      status: "completed",
      fulfilmentMethod: "collection",
      enteredAt: new Date("2026-06-09T04:50:00.000Z"), // 05:50 London (BST, UTC+1) in June
      createdAt: new Date("2026-06-09T04:50:00.000Z"),
      readyAt: new Date("2026-06-09T07:00:00.000Z"),
      settledAt: new Date("2026-06-09T07:00:00.000Z"),
    });

    const report = await orderTimingReport(orgId, new Date("2026-06-09T00:00:00.000Z"), new Date("2026-06-09T23:59:59.000Z"));
    const row = await findRow(report.rows, orderId);
    expect(row?.excluded).toBe("carried-over");
  });
});

describe("orderTimingReport — the BST/GMT boundary (brief DoD)", () => {
  it("buckets a span across the October clock-back into one trading day with an exact duration", async () => {
    // 25 October 2026: London goes BST -> GMT at 02:00 local. Received
    // 00:30Z (01:30 BST, before the change), ready 05:30Z (05:30 GMT, after
    // it) — both within the 24th's 25-hour trading day.
    const orderId = await makeOrder({
      status: "completed",
      fulfilmentMethod: "collection",
      enteredAt: new Date("2026-10-25T00:30:00.000Z"),
      createdAt: new Date("2026-10-25T00:30:00.000Z"),
      readyAt: new Date("2026-10-25T05:30:00.000Z"),
      settledAt: new Date("2026-10-25T05:30:00.000Z"),
    });

    const report = await orderTimingReport(orgId, new Date("2026-10-24T00:00:00.000Z"), new Date("2026-10-26T00:00:00.000Z"));
    const row = await findRow(report.rows, orderId);
    expect(row?.excluded).toBeNull(); // NOT carried-over
    expect(row?.tradingDay).toBe("2026-10-24");
    expect(row?.receivedToReadyMinutes).toBeCloseTo(300, 5);
  });
});

describe("orderTimingReport — assignee station comes from ops_staff", () => {
  it("resolves the assignee's station from ops_staff, not a bespoke lookup", async () => {
    const userId = `priya-${SUFFIX}`;
    await db.insert(opsStaff).values({ orgId, userId, station: "delivery" });
    const receivedAt = new Date("2026-06-04T10:00:00.000Z");
    const orderId = await makeOrder({
      status: "completed",
      fulfilmentMethod: "delivery",
      enteredAt: receivedAt,
      createdAt: receivedAt,
      settledAt: new Date("2026-06-04T10:30:00.000Z"),
      assignedUserId: userId,
    });

    const report = await orderTimingReport(orgId, new Date("2026-06-04T00:00:00.000Z"), new Date("2026-06-04T23:59:59.000Z"));
    const row = await findRow(report.rows, orderId);
    expect(row?.station).toBe("delivery");
  });
});

describe("orderTimingReport — red flags", () => {
  it("flags collection on-time below 80% from real seeded data", async () => {
    const day = "2026-06-05";
    const received = new Date(`${day}T10:00:00.000Z`);
    // Four collection orders, three late, one on time — 25% on-time.
    for (let i = 0; i < 3; i += 1) {
      await makeOrder({
        status: "completed",
        fulfilmentMethod: "collection",
        enteredAt: received,
        createdAt: received,
        etaGiven: new Date(`${day}T10:10:00.000Z`),
        readyAt: new Date(`${day}T10:20:00.000Z`), // after the promise
        settledAt: new Date(`${day}T10:25:00.000Z`),
      });
    }
    await makeOrder({
      status: "completed",
      fulfilmentMethod: "collection",
      enteredAt: received,
      createdAt: received,
      etaGiven: new Date(`${day}T10:10:00.000Z`),
      readyAt: new Date(`${day}T10:05:00.000Z`), // before the promise
      settledAt: new Date(`${day}T10:15:00.000Z`),
    });

    const report = await orderTimingReport(orgId, new Date(`${day}T00:00:00.000Z`), new Date(`${day}T23:59:59.000Z`));
    expect(report.summary.collectionOnTimePercent).toBeCloseTo(25, 5);
    expect(report.redFlags.some((f) => f.includes("Collection on-time"))).toBe(true);
  });
});

describe("delayLog — re-sourced from order_events (DoD: 'Delay Log shows a cleared delay')", () => {
  it("shows a delay that was cleared — invisible under the old orders.delayFlag query", async () => {
    const day = "2026-06-06";
    const orderId = await makeOrder({ status: "pending" });
    const delayedAt = new Date(`${day}T09:00:00.000Z`);
    const clearedAt = new Date(`${day}T09:20:00.000Z`);
    await db.insert(orderEvents).values({
      orgId,
      orderId,
      kind: "delayed",
      at: delayedAt,
      userId: null,
      meta: { cause: "Queue", reason: "busy till", revisedEta: null, customerTold: true },
    });
    await db.insert(orderEvents).values({
      orgId,
      orderId,
      kind: "delay_cleared",
      at: clearedAt,
      userId: null,
      meta: { resolution: "Collected late" },
    });

    const report = await delayLog(orgId, new Date(`${day}T12:00:00.000Z`));
    const row = report.rows.find((r) => r.orderId === orderId.slice(0, 8));
    expect(row).toBeDefined();
    expect(row?.clearedAt).toBe(clearedAt.toISOString());
    expect(row?.resolution).toBe("Collected late");
    expect(row?.delayDuration).toBeCloseTo(20, 5);
    expect(report.summary.stillOpen).toBe(0);
  });

  it("leaves a delay that was never cleared as still open", async () => {
    const day = "2026-06-07";
    const orderId = await makeOrder({ status: "pending" });
    await db.insert(orderEvents).values({
      orgId,
      orderId,
      kind: "delayed",
      at: new Date(`${day}T09:00:00.000Z`),
      userId: null,
      meta: { cause: "Stock", reason: null, revisedEta: null, customerTold: false },
    });

    const report = await delayLog(orgId, new Date(`${day}T12:00:00.000Z`));
    const row = report.rows.find((r) => r.orderId === orderId.slice(0, 8));
    expect(row?.clearedAt).toBeNull();
    expect(row?.resolution).toBeNull();
    expect(report.summary.stillOpen).toBe(1);
  });
});
