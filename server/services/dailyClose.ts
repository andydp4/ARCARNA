import { db } from "../db";
import {
  cashierCommissionEntries,
  cashierShifts,
  creditPayments,
  dailyCloseRuns,
  orderCredit,
  orderPayments,
  orders,
  organizations,
  orgNotifications,
  shifts,
} from "@shared/schema";
import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { lastClosedTradingDay, tradingDayBounds } from "@shared/time/tradingDay";
import { closeCashierShift } from "./cashierShiftEngine";
import { isPersonalUse } from "@shared/reports/cashierShiftReport";

/**
 * The 06:00 close.
 *
 * Each morning the previous trading day is totalled, the shifts that traded it
 * are closed, and the day's Signals go out. Nobody has to remember to do it at
 * the end of the night.
 *
 * It runs on the worker loop's housekeeping pass rather than a cron, because
 * the repo has no scheduler and does not need one. Housekeeping runs every
 * fifteen minutes, so the close lands within fifteen minutes of 06:00 — and
 * being late is harmless, because the day it totals is a fixed window that has
 * already finished.
 */

function money(n: number): string {
  return `£${n.toFixed(2)}`;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export type DailyCloseResult = {
  orgId: string;
  tradingDay: string;
  alreadyRun: boolean;
  shiftsClosed: number;
  uncountedDrawers: number;
};

/**
 * Closes one organisation's trading day. Safe to call repeatedly.
 *
 * The `daily_close_runs` insert is the lock: whoever writes the row does the
 * work, and everyone else sees it and stops. That is what stops a server
 * restarted at 06:00 from totalling the day twice and sending the Signals
 * twice.
 */
export async function closeTradingDay(
  orgId: string,
  tradingDay: string,
  timeZone: string,
): Promise<DailyCloseResult> {
  const [claim] = await db
    .insert(dailyCloseRuns)
    .values({ orgId, tradingDay })
    .onConflictDoNothing()
    .returning({ id: dailyCloseRuns.id });

  if (!claim) {
    return { orgId, tradingDay, alreadyRun: true, shiftsClosed: 0, uncountedDrawers: 0 };
  }

  const { start, end } = tradingDayBounds(tradingDay, timeZone);

  // Close the cashier shifts that traded this day. These are logical shifts —
  // no cash count is involved — so they can be closed without a human.
  const openShifts = await db
    .select({ id: cashierShifts.id })
    .from(cashierShifts)
    .where(
      and(
        eq(cashierShifts.orgId, orgId),
        eq(cashierShifts.tradingDay, tradingDay),
        eq(cashierShifts.status, "open"),
      ),
    );

  let shiftsClosed = 0;
  for (const shift of openShifts) {
    try {
      await closeCashierShift(orgId, shift.id, {
        closedByUserId: null,
        closeReason: "inactivity_auto_close",
      });
      shiftsClosed += 1;
    } catch (error) {
      // One shift failing must not abandon the rest of the day.
      console.error("[DailyClose] Could not close cashier shift", shift.id, error);
    }
  }

  const totals = await totalsForDay(orgId, start, end, tradingDay);

  // Drawers still open are counted and named, never closed. A cash drawer
  // closed without being counted can never be reconciled afterwards, and
  // somebody may well be cashing up at five past six.
  const [{ count: uncountedDrawers }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(shifts)
    .where(and(eq(shifts.orgId, orgId), eq(shifts.status, "open"), lt(shifts.openedAt, end)));

  await db
    .update(dailyCloseRuns)
    .set({
      shiftsClosed,
      uncountedDrawers,
      orderCount: totals.orderCount,
      grossSales: String(totals.grossSales),
      cashSales: String(totals.cashSales),
      cardSales: String(totals.cardSales),
      creditGiven: String(totals.creditGiven),
      creditResolved: String(totals.creditResolved),
      personalUseCost: String(totals.personalUseCost),
      commissionAccrued: String(totals.commissionAccrued),
    })
    .where(eq(dailyCloseRuns.id, claim.id));

  await raiseSignals(orgId, tradingDay, { ...totals, shiftsClosed, uncountedDrawers });

  return { orgId, tradingDay, alreadyRun: false, shiftsClosed, uncountedDrawers };
}

type DayTotals = {
  orderCount: number;
  grossSales: number;
  cashSales: number;
  cardSales: number;
  creditGiven: number;
  creditResolved: number;
  personalUseCost: number;
  commissionAccrued: number;
};

async function totalsForDay(
  orgId: string,
  start: Date,
  end: Date,
  tradingDay: string,
): Promise<DayTotals> {
  const dayOrders = await db
    .select({ id: orders.id, total: orders.total, paymentMethod: orders.paymentMethod })
    .from(orders)
    .where(and(eq(orders.orgId, orgId), gte(orders.createdAt, start), lt(orders.createdAt, end)));

  // Personal use is not a sale and never counts as one.
  const sales = dayOrders.filter((o) => !isPersonalUse(o.paymentMethod));
  const grossSales = round(sales.reduce((sum, o) => sum + parseFloat(String(o.total)), 0));
  const orderIds = dayOrders.map((o) => o.id);

  // Cash and card come from the tender legs, so a split sale lands in both.
  const legs = orderIds.length
    ? await db
        .select({ method: orderPayments.method, amount: orderPayments.amount })
        .from(orderPayments)
        .where(inArray(orderPayments.orderId, orderIds))
    : [];
  const sumLegs = (matches: (m: string) => boolean) =>
    round(
      legs
        .filter((l) => matches(l.method.toLowerCase()))
        .reduce((sum, l) => sum + parseFloat(String(l.amount)), 0),
    );

  const creditGivenRows = await db
    .select({ amount: orderCredit.amountGiven })
    .from(orderCredit)
    .where(and(eq(orderCredit.orgId, orgId), eq(orderCredit.givenOn, tradingDay)));

  const creditPaidRows = await db
    .select({ amount: creditPayments.amount })
    .from(creditPayments)
    .where(and(eq(creditPayments.orgId, orgId), eq(creditPayments.paidOn, tradingDay)));

  const commissionRows = await db
    .select({ amount: cashierCommissionEntries.amount })
    .from(cashierCommissionEntries)
    .where(
      and(
        eq(cashierCommissionEntries.orgId, orgId),
        eq(cashierCommissionEntries.accruedOn, tradingDay),
        isNull(cashierCommissionEntries.reversalOf),
      ),
    );

  const personalUseCost = round(
    legs
      .filter((l) => isPersonalUse(l.method))
      .reduce((sum, l) => sum + parseFloat(String(l.amount)), 0),
  );

  const total = (rows: Array<{ amount: string }>) =>
    round(rows.reduce((sum, r) => sum + parseFloat(String(r.amount)), 0));

  return {
    orderCount: sales.length,
    grossSales,
    cashSales: sumLegs((m) => m === "cash" || m.includes("cash")),
    cardSales: sumLegs((m) => m === "card" || m.includes("card")),
    creditGiven: total(creditGivenRows),
    creditResolved: total(creditPaidRows),
    personalUseCost,
    commissionAccrued: total(commissionRows),
  };
}

/**
 * The day's Signals.
 *
 * One saying what the day did, and one for anything that needs a person —
 * a drawer nobody counted. A quiet day says nothing at all rather than
 * reporting a row of zeroes nobody reads.
 */
async function raiseSignals(
  orgId: string,
  tradingDay: string,
  totals: DayTotals & { shiftsClosed: number; uncountedDrawers: number },
): Promise<void> {
  if (totals.orderCount === 0 && totals.creditResolved === 0 && totals.uncountedDrawers === 0) {
    return;
  }

  const lines = [
    `${totals.orderCount} orders, ${money(totals.grossSales)} taken.`,
    `Cash ${money(totals.cashSales)}, card ${money(totals.cardSales)}.`,
  ];
  if (totals.creditGiven > 0) lines.push(`Credit given out ${money(totals.creditGiven)}.`);
  if (totals.creditResolved > 0) lines.push(`Credit resolved ${money(totals.creditResolved)}.`);
  if (totals.personalUseCost > 0) lines.push(`Personal use ${money(totals.personalUseCost)}.`);
  lines.push(`Commission earned ${money(totals.commissionAccrued)}.`);

  await db.insert(orgNotifications).values({
    orgId,
    title: `Trading day closed — ${tradingDay}`,
    message: lines.join(" "),
    severity: "info",
    source: "daily_close",
    metadata: { tradingDay, ...totals },
  });

  if (totals.uncountedDrawers > 0) {
    await db.insert(orgNotifications).values({
      orgId,
      title: `${totals.uncountedDrawers} drawer${totals.uncountedDrawers === 1 ? "" : "s"} not counted`,
      // Deliberately not closed for them: a drawer closed without a count can
      // never be reconciled, so this asks rather than acts.
      message:
        `The trading day of ${tradingDay} closed with ${totals.uncountedDrawers} till ` +
        `drawer${totals.uncountedDrawers === 1 ? "" : "s"} still open. Cash up to record the variance — ` +
        `a drawer closed without being counted cannot be reconciled afterwards.`,
      severity: "warning",
      source: "daily_close",
      metadata: { tradingDay, uncountedDrawers: totals.uncountedDrawers },
    });
  }
}

/**
 * Closes any trading day that has finished and has not been closed yet.
 *
 * Called from the worker loop's housekeeping pass. Catching up matters as much
 * as running on time: a server down over a weekend comes back and closes each
 * missed day in turn, dated correctly, rather than skipping them.
 */
export async function runDueDailyCloses(now: Date = new Date()): Promise<DailyCloseResult[]> {
  const orgs = await db
    .select({ id: organizations.id, timezone: organizations.timezone })
    .from(organizations);

  const results: DailyCloseResult[] = [];
  for (const org of orgs) {
    const timeZone = org.timezone ?? "Europe/London";
    const day = lastClosedTradingDay(timeZone, now);
    try {
      const result = await closeTradingDay(org.id, day, timeZone);
      if (!result.alreadyRun) results.push(result);
    } catch (error) {
      console.error("[DailyClose] Failed for org", org.id, day, error);
    }
  }
  return results;
}
