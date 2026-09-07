import { db } from "../db";
import { cashierShifts, organizations, type CashierShift } from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";
import { currentTradingDay } from "@shared/time/tradingDay";

/**
 * Finds or opens a person's shift for the trading day in progress.
 *
 * There is no "open shift" step any more. The first order somebody creates or
 * completes on a trading day opens their shift; everything after it finds the
 * same one. Logging out for a break and back in returns to it, because a shift
 * is a trading day rather than a login session — only the 06:00 cut ends it.
 *
 * Safe to call concurrently. Two tills taking the same person's first sale of
 * the day both try to insert; the unique index on (org, user, trading day)
 * means one wins and the other reads what it wrote, rather than the day's
 * takings ending up split across two shifts (migration 058).
 *
 * Only ever finds an OPEN shift for today. That's correct here: an
 * auto-closed shift for the day in progress is a finished session, and the
 * next sale should start a fresh one rather than reopen it. A backdated
 * order needs the opposite rule — see resolveShiftForBackdatedDay below.
 */
export async function resolveShiftForToday(
  orgId: string,
  userId: string,
  now: Date = new Date(),
): Promise<CashierShift | null> {
  if (!orgId || !userId) return null;

  const [org] = await db
    .select({ timezone: organizations.timezone })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!org) return null;

  const tradingDay = currentTradingDay(org.timezone ?? "Europe/London", now);
  return findOrCreateShift(orgId, userId, tradingDay, { anyStatus: false });
}

/**
 * Finds or opens a person's shift for an already-known trading day —
 * open OR already closed.
 *
 * A backdated order's shift for that day is closed the moment it lands
 * (settleBackdatedShift, since that trading day is already over). Looking
 * for an OPEN shift only, as resolveShiftForToday does, means a SECOND
 * backdated order for the same day never finds the shift the first one just
 * closed — it opens a new one beside it, which settleBackdatedShift then
 * closes too, and so on for every subsequent entry. That is what fragmented
 * a day's backdated sales into one shift per order: each carried its own
 * partial report, and once migration 060's unique index was in place the
 * fragmentation stopped being silent and started failing the deploy outright
 * (two "closed" rows for the same org/user/day collide on that index the
 * same as two open ones would).
 *
 * This is the fix: a backdated order looks for its day's shift regardless of
 * status, so a second (or fifth) entry for an already-settled day lands on
 * the same row settleBackdatedShift's closed branch already knows how to
 * bring up to date (refreshClosedCashierShiftSummary), instead of opening a
 * new one.
 */
export async function resolveShiftForBackdatedDay(
  orgId: string,
  userId: string,
  tradingDay: string,
): Promise<CashierShift | null> {
  if (!orgId || !userId || !tradingDay) return null;
  return findOrCreateShift(orgId, userId, tradingDay, { anyStatus: true });
}

async function findOrCreateShift(
  orgId: string,
  userId: string,
  tradingDay: string,
  opts: { anyStatus: boolean },
): Promise<CashierShift | null> {
  const existing = await findShift(orgId, userId, tradingDay, opts);
  if (existing) return existing;

  const [created] = await db
    .insert(cashierShifts)
    .values({
      orgId,
      userId,
      tradingDay,
      openedByUserId: userId,
      status: "open",
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  // Lost the race (or, for a backdated day, the unique index already holds a
  // closed row for it) — whoever/whatever got there first has the row we want.
  return findShift(orgId, userId, tradingDay, opts);
}

async function findShift(
  orgId: string,
  userId: string,
  tradingDay: string,
  opts: { anyStatus: boolean },
): Promise<CashierShift | null> {
  const conditions = [
    eq(cashierShifts.orgId, orgId),
    eq(cashierShifts.userId, userId),
    eq(cashierShifts.tradingDay, tradingDay),
    isNull(cashierShifts.cashierId),
  ];
  if (!opts.anyStatus) conditions.push(eq(cashierShifts.status, "open"));
  const [row] = await db
    .select()
    .from(cashierShifts)
    .where(and(...conditions))
    .limit(1);
  return row ?? null;
}

/** The org's timezone, defaulting to where the business actually is. */
export async function orgTimeZone(orgId: string): Promise<string> {
  const [org] = await db
    .select({ timezone: organizations.timezone })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return org?.timezone ?? "Europe/London";
}
