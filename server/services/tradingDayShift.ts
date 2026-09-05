import { db } from "../db";
import { cashierShifts, organizations, type CashierShift } from "@shared/schema";
import { and, eq } from "drizzle-orm";
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

  const existing = await findShift(orgId, userId, tradingDay);
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

  // Lost the race. Whoever won has written the row we wanted.
  return findShift(orgId, userId, tradingDay);
}

async function findShift(
  orgId: string,
  userId: string,
  tradingDay: string,
): Promise<CashierShift | null> {
  const [row] = await db
    .select()
    .from(cashierShifts)
    .where(
      and(
        eq(cashierShifts.orgId, orgId),
        eq(cashierShifts.userId, userId),
        eq(cashierShifts.tradingDay, tradingDay),
      ),
    )
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
