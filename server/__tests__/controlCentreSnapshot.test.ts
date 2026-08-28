/**
 * The Control Centre's single data source, and the two bugs it replaces:
 *
 *   1. "Completed today" used to filter by the order's CREATED date. Arcarna
 *      is pick-and-pack, so an order taken one trading day and handed over
 *      the next is completed today but created yesterday — exactly the case
 *      that tile always missed.
 *   2. "Orders today" and "Revenue today" used two different definitions of
 *      "today" (calendar day at two different timezones) that could — and on
 *      the live dashboard, did — disagree with each other on the same page.
 *
 * Both are now the same trading day everywhere: 06:00 to 06:00 in the org's
 * timezone, fixed here at "Europe/London" and pinned to January so GMT (no
 * DST) keeps the arithmetic easy to follow.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { orders, organizations, dailyCloseRuns } from "@shared/schema";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("the Control Centre snapshot", () => {
  let orgId: string;
  let db: (typeof import("../db"))["db"];
  let getControlCentreSnapshot: (typeof import("../services/controlCentre"))["getControlCentreSnapshot"];

  // Fixed at 10:00 London-local on the 15th (GMT, no DST): well clear of the
  // 06:00 cut, so "now" unambiguously falls on the 15th's trading day.
  const NOW = new Date("2026-01-15T10:00:00.000Z");

  beforeEach(async () => {
    ({ db } = await import("../db"));
    ({ getControlCentreSnapshot } = await import("../services/controlCentre"));

    orgId = randomUUID();
    await db.insert(organizations).values({ id: orgId, name: "Control Centre Snapshot Test" });
  });

  afterEach(async () => {
    await db.delete(dailyCloseRuns).where(eq(dailyCloseRuns.orgId, orgId));
    await db.delete(orders).where(eq(orders.orgId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("counts an order created yesterday's trading day but settled today as completed today", async () => {
    await db.insert(orders).values({
      id: randomUUID(),
      orgId,
      total: "80.00",
      paymentMethod: "cash",
      status: "completed",
      createdAt: new Date("2026-01-14T18:00:00.000Z"), // 14th's trading day
      settledTotal: "80.00",
      settledAt: new Date("2026-01-15T07:00:00.000Z"), // 15th's trading day
    } as never);

    const snap = await getControlCentreSnapshot(orgId, NOW);

    expect(snap.tradingDay).toBe("2026-01-15");
    expect(snap.ordersCompletedToday).toBe(1);
    // The old bug's exact shape: this order was NOT created today, so a
    // created_at-based count would still read zero.
    expect(snap.ordersCreatedToday).toBe(0);
    expect(snap.today.revenue).toBe(80);
  });

  it("does not count an order created today but not yet completed", async () => {
    await db.insert(orders).values({
      id: randomUUID(),
      orgId,
      total: "45.00",
      paymentMethod: "cash",
      status: "pending",
      createdAt: new Date("2026-01-15T09:00:00.000Z"),
    } as never);

    const snap = await getControlCentreSnapshot(orgId, NOW);

    expect(snap.ordersCreatedToday).toBe(1);
    expect(snap.ordersCompletedToday).toBe(0);
    expect(snap.openOrders).toBe(1);
    expect(snap.today.revenue).toBe(0);
  });

  it("flags yesterday's close as missing when no close run is recorded", async () => {
    const snap = await getControlCentreSnapshot(orgId, NOW);

    expect(snap.yesterdayTradingDay).toBe("2026-01-14");
    expect(snap.yesterdayCloseRan).toBe(false);
    expect(snap.nextMoves.some((m) => m.id === "close-missing")).toBe(true);
  });

  it("stops flagging the close once it has actually run", async () => {
    await db.insert(dailyCloseRuns).values({
      id: randomUUID(),
      orgId,
      tradingDay: "2026-01-14",
      shiftsClosed: 1,
    } as never);

    const snap = await getControlCentreSnapshot(orgId, NOW);

    expect(snap.yesterdayCloseRan).toBe(true);
    expect(snap.nextMoves.some((m) => m.id === "close-missing")).toBe(false);
  });

  it("does not flag a missing close in the first minutes of a new trading day", async () => {
    // 06:05 London-local on the 15th — five minutes into the new trading day,
    // before the close worker has necessarily had a turn to run.
    const justAfterCut = new Date("2026-01-15T06:05:00.000Z");

    const snap = await getControlCentreSnapshot(orgId, justAfterCut);

    expect(snap.yesterdayCloseRan).toBe(true);
    expect(snap.nextMoves.some((m) => m.id === "close-missing")).toBe(false);
  });

  it("ranks next moves by severity: error before warning before info", async () => {
    // No close run recorded -> error. No other org-scoped state here produces
    // warning/info signals deterministically without touching global tables
    // (stock, dead letters), so this asserts ordering holds for whatever the
    // list contains rather than asserting its exact membership.
    const snap = await getControlCentreSnapshot(orgId, NOW);

    const ranks = { error: 0, warning: 1, info: 2 } as const;
    for (let i = 1; i < snap.nextMoves.length; i++) {
      expect(ranks[snap.nextMoves[i - 1].severity]).toBeLessThanOrEqual(
        ranks[snap.nextMoves[i].severity],
      );
    }
  });
});
