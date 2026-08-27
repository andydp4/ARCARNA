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
import { resolveShiftForToday } from "../services/tradingDayShift";

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

  it("does not attach a lazy sale to a historic closed cashier-code shift", async () => {
    const [cashier] = await db
      .insert(cashierProfiles)
      .values({ orgId, cashierCode: `H${SUFFIX}`.slice(0, 12), displayName: "Historic code" })
      .returning();
    const [historic] = await db
      .insert(cashierShifts)
      .values({
        orgId,
        cashierId: cashier.id,
        userId: ALICE,
        tradingDay: "2026-04-04",
        openedByUserId: ALICE,
        status: "closed",
        closedAt: new Date("2026-04-04T12:00:00Z"),
      })
      .returning();

    const shift = await resolveShiftForToday(orgId, ALICE, new Date("2026-04-04T14:00:00Z"));

    expect(shift).not.toBeNull();
    expect(shift!.id).not.toBe(historic.id);
    expect(shift!.cashierId).toBeNull();
    expect(shift!.status).toBe("open");
  });

  it("needs both an org and a person", async () => {
    expect(await resolveShiftForToday("", ALICE)).toBeNull();
    expect(await resolveShiftForToday(orgId, "")).toBeNull();
  });
});
