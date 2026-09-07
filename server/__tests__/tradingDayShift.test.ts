/**
 * A shift is one person's trading day, opened on their first sale of it.
 *
 * The properties that matter: it opens itself, it is found again rather than
 * duplicated, it survives logging out for a break, and two people on at once
 * get a shift each. Racing callers must not split a day's takings across two
 * shifts, which is what the unique index on (org, user, trading day) prevents.
 *
 * Runs against a real database, so it is excluded from the no-DB run.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import { cashierProfiles, cashierShifts, organizations } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { resolveShiftForBackdatedDay, resolveShiftForToday } from "../services/tradingDayShift";

const SUFFIX = Date.now().toString(36);
let orgId: string;

const ALICE = `user-alice-${SUFFIX}`;
const BOB = `user-bob-${SUFFIX}`;

beforeAll(async () => {
  const [org] = await db
    .insert(organizations)
    .values({ name: `trading-day-${SUFFIX}`, timezone: "Europe/London" })
    .returning();
  orgId = org.id;
});

afterAll(async () => {
  if (!orgId) return;
  await db.delete(cashierShifts).where(eq(cashierShifts.orgId, orgId));
  await db.delete(cashierProfiles).where(eq(cashierProfiles.orgId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
});

describe("opening a shift without anybody opening a shift", () => {
  it("opens one on the first sale of the trading day", async () => {
    const shift = await resolveShiftForToday(orgId, ALICE, new Date("2026-01-12T09:00:00Z"));

    expect(shift).not.toBeNull();
    expect(shift!.userId).toBe(ALICE);
    expect(shift!.tradingDay).toBe("2026-01-12");
    expect(shift!.status).toBe("open");
  });

  it("finds the same shift on every sale after it", async () => {
    const first = await resolveShiftForToday(orgId, ALICE, new Date("2026-01-12T09:00:00Z"));
    const later = await resolveShiftForToday(orgId, ALICE, new Date("2026-01-12T17:30:00Z"));

    expect(later!.id).toBe(first!.id);
  });

  it("returns the same shift after a break, because a break is not a new day", async () => {
    // Logged out at lunch, back at two. Same trading day, same shift.
    const before = await resolveShiftForToday(orgId, ALICE, new Date("2026-01-12T11:55:00Z"));
    const after = await resolveShiftForToday(orgId, ALICE, new Date("2026-01-12T14:05:00Z"));

    expect(after!.id).toBe(before!.id);
  });

  it("keeps a late night on the same shift as the evening it started", async () => {
    // 01:30 is still the 12th's trading day — the cut is 06:00, not midnight.
    const evening = await resolveShiftForToday(orgId, ALICE, new Date("2026-01-12T23:30:00Z"));
    const afterMidnight = await resolveShiftForToday(orgId, ALICE, new Date("2026-01-13T01:30:00Z"));

    expect(afterMidnight!.id).toBe(evening!.id);
    expect(afterMidnight!.tradingDay).toBe("2026-01-12");
  });

  it("starts a new shift once the 06:00 cut has passed", async () => {
    const yesterday = await resolveShiftForToday(orgId, ALICE, new Date("2026-01-13T05:59:00Z"));
    const today = await resolveShiftForToday(orgId, ALICE, new Date("2026-01-13T06:01:00Z"));

    expect(today!.id).not.toBe(yesterday!.id);
    expect(yesterday!.tradingDay).toBe("2026-01-12");
    expect(today!.tradingDay).toBe("2026-01-13");
  });

  it("gives two people on at once a shift each", async () => {
    const alice = await resolveShiftForToday(orgId, ALICE, new Date("2026-02-02T10:00:00Z"));
    const bob = await resolveShiftForToday(orgId, BOB, new Date("2026-02-02T10:00:00Z"));

    expect(alice!.id).not.toBe(bob!.id);
    expect(alice!.tradingDay).toBe(bob!.tradingDay);
  });

  it("does not split a day across two shifts when sales race", async () => {
    // Two tills take the same person's first sale of the day at once.
    const at = new Date("2026-03-03T10:00:00Z");
    const results = await Promise.all([
      resolveShiftForToday(orgId, BOB, at),
      resolveShiftForToday(orgId, BOB, at),
      resolveShiftForToday(orgId, BOB, at),
    ]);

    const ids = new Set(results.map((r) => r!.id));
    expect(ids.size).toBe(1);

    const rows = await db
      .select()
      .from(cashierShifts)
      .where(
        and(
          eq(cashierShifts.orgId, orgId),
          eq(cashierShifts.userId, BOB),
          eq(cashierShifts.tradingDay, "2026-03-03"),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("ignores a closed historical coded shift and opens a live lazy shift", async () => {
    const userId = `user-historic-${SUFFIX}`;
    const [profile] = await db
      .insert(cashierProfiles)
      .values({ orgId, cashierCode: `H${SUFFIX}`.slice(0, 12), displayName: "Historic cashier" })
      .returning();
    const [closed] = await db
      .insert(cashierShifts)
      .values({
        orgId,
        cashierId: profile.id,
        userId,
        tradingDay: "2026-04-04",
        openedByUserId: userId,
        status: "closed",
        closedAt: new Date("2026-04-04T12:00:00Z"),
      })
      .returning();

    const shift = await resolveShiftForToday(orgId, userId, new Date("2026-04-04T14:00:00Z"));

    expect(shift!.id).not.toBe(closed.id);
    expect(shift!.status).toBe("open");
    expect(shift!.cashierId).toBeNull();
  });

  it("opens a fresh lazy shift after a same-day lazy shift was closed", async () => {
    const userId = `user-closed-lazy-${SUFFIX}`;
    const [closed] = await db
      .insert(cashierShifts)
      .values({
        orgId,
        userId,
        tradingDay: "2026-04-05",
        openedByUserId: userId,
        status: "closed",
        closedAt: new Date("2026-04-05T12:00:00Z"),
      })
      .returning();

    const shift = await resolveShiftForToday(orgId, userId, new Date("2026-04-05T14:00:00Z"));

    expect(shift!.id).not.toBe(closed.id);
    expect(shift!.status).toBe("open");
    expect(shift!.cashierId).toBeNull();
  });

  it("needs both an org and a person", async () => {
    expect(await resolveShiftForToday("", ALICE)).toBeNull();
    expect(await resolveShiftForToday(orgId, "")).toBeNull();
  });
});

describe("resolving a backdated day's shift, open or already closed", () => {
  it("opens one when the day never had a shift", async () => {
    const userId = `user-backdate-fresh-${SUFFIX}`;
    const shift = await resolveShiftForBackdatedDay(orgId, userId, "2026-05-05");

    expect(shift).not.toBeNull();
    expect(shift!.tradingDay).toBe("2026-05-05");
    expect(shift!.status).toBe("open");
  });

  // The regression this exists for: settleBackdatedShift closes a backdated
  // day's shift the moment the first order lands, because that day is
  // already over. A second backdated order for the same day must find that
  // same now-closed row — resolveShiftForToday's open-only lookup cannot see
  // it, which is exactly what fragmented one backdated catch-up day into a
  // shift per order.
  it("finds an already-closed shift for the day rather than opening another", async () => {
    const userId = `user-backdate-closed-${SUFFIX}`;
    const [closed] = await db
      .insert(cashierShifts)
      .values({
        orgId,
        userId,
        tradingDay: "2026-05-06",
        openedByUserId: userId,
        status: "auto_closed",
        closedAt: new Date("2026-05-06T20:00:00Z"),
      })
      .returning();

    const found = await resolveShiftForBackdatedDay(orgId, userId, "2026-05-06");

    expect(found!.id).toBe(closed.id);
    expect(found!.status).toBe("auto_closed");
  });

  it("still ignores a closed historical coded shift and opens a fresh lazy one", async () => {
    const userId = `user-backdate-historic-${SUFFIX}`;
    const [profile] = await db
      .insert(cashierProfiles)
      .values({ orgId, cashierCode: `BD${SUFFIX}`.slice(0, 12), displayName: "Backdate historic" })
      .returning();
    const [coded] = await db
      .insert(cashierShifts)
      .values({
        orgId,
        cashierId: profile.id,
        userId,
        tradingDay: "2026-05-07",
        openedByUserId: userId,
        status: "closed",
        closedAt: new Date("2026-05-07T20:00:00Z"),
      })
      .returning();

    const found = await resolveShiftForBackdatedDay(orgId, userId, "2026-05-07");

    expect(found!.id).not.toBe(coded.id);
    expect(found!.cashierId).toBeNull();
  });

  it("does not split a backdated day across two shifts when entries race", async () => {
    const userId = `user-backdate-race-${SUFFIX}`;
    const results = await Promise.all([
      resolveShiftForBackdatedDay(orgId, userId, "2026-05-08"),
      resolveShiftForBackdatedDay(orgId, userId, "2026-05-08"),
      resolveShiftForBackdatedDay(orgId, userId, "2026-05-08"),
    ]);

    const ids = new Set(results.map((r) => r!.id));
    expect(ids.size).toBe(1);
  });

  it("needs an org, a person and a day", async () => {
    expect(await resolveShiftForBackdatedDay("", ALICE, "2026-05-09")).toBeNull();
    expect(await resolveShiftForBackdatedDay(orgId, "", "2026-05-09")).toBeNull();
    expect(await resolveShiftForBackdatedDay(orgId, ALICE, "")).toBeNull();
  });
});
