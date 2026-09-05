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
import { lastClosedTradingDay, shiftIsoDate, tradingDayBounds } from "@shared/time/tradingDay";
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

type DailyCloseDb = Pick<typeof db, "select" | "insert" | "update">;

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
 * A transaction-scoped advisory lock serializes the close for this org/day.
 * The run row is written at the end, after the totals and Signals have been
 * prepared, so a transient failure can be retried instead of leaving a
 * permanent zero-total "success" row behind.
 */
export async function closeTradingDay(
  orgId: string,
  tradingDay: string,
  timeZone: string,
): Promise<DailyCloseResult> {
  const { start, end } = tradingDayBounds(tradingDay, timeZone);

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`daily-close:${orgId}:${tradingDay}`}))`);

    const [existing] = await tx
      .select({ id: dailyCloseRuns.id })
      .from(dailyCloseRuns)
      .where(and(eq(dailyCloseRuns.orgId, orgId), eq(dailyCloseRuns.tradingDay, tradingDay)))
      .for("update")
      .limit(1);

    if (existing) {
      return { orgId, tradingDay, alreadyRun: true, shiftsClosed: 0, uncountedDrawers: 0 };
    }

    // Close the cashier shifts that traded this day. These are logical shifts —
    // no cash count is involved — so they can be closed without a human.
    const openShifts = await tx
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

    const totals = await totalsForDay(orgId, start, end, tradingDay, tx);

    // Drawers still open are counted and named, never closed. A cash drawer
    // closed without being counted can never be reconciled afterwards, and
    // somebody may well be cashing up at five past six.
    const [{ count: uncountedDrawers }] = await tx
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(shifts)
      .where(and(eq(shifts.orgId, orgId), eq(shifts.status, "open"), lt(shifts.openedAt, end)));

    const [run] = await tx
      .insert(dailyCloseRuns)
      .values({
        orgId,
        tradingDay,
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
      .onConflictDoNothing()
      .returning({ id: dailyCloseRuns.id });

    if (!run) {
      return { orgId, tradingDay, alreadyRun: true, shiftsClosed: 0, uncountedDrawers: 0 };
    }

    await raiseSignals(orgId, tradingDay, { ...totals, shiftsClosed, uncountedDrawers }, tx);

    return { orgId, tradingDay, alreadyRun: false, shiftsClosed, uncountedDrawers };
  });
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
  client: DailyCloseDb = db,
): Promise<DayTotals> {
  const dayOrders = await client
    .select({
      id: orders.id,
      total: orders.total,
      settledTotal: orders.settledTotal,
      paymentMethod: orders.paymentMethod,
    })
    .from(orders)
    .where(
      and(
        eq(orders.orgId, orgId),
        eq(orders.status, "completed"),
        gte(orders.settledAt, start),
        lt(orders.settledAt, end),
      ),
    );

  // Personal use is not a sale and never counts as one.
  const sales = dayOrders.filter((o) => !isPersonalUse(o.paymentMethod));
  const grossSales = round(
    sales.reduce((sum, o) => sum + parseFloat(String(o.settledTotal ?? o.total)), 0),
  );
  const orderIds = dayOrders.map((o) => o.id);

  // Cash and card come from the tender legs, so a split sale lands in both.
  const legs = orderIds.length
    ? await client
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

  const creditGivenRows = await client
    .select({ amount: orderCredit.amountGiven })
    .from(orderCredit)
    .where(and(eq(orderCredit.orgId, orgId), eq(orderCredit.givenOn, tradingDay)));

  const creditPaidRows = await client
    .select({ amount: creditPayments.amount })
    .from(creditPayments)
    .where(and(eq(creditPayments.orgId, orgId), eq(creditPayments.paidOn, tradingDay)));

  const commissionRows = await client
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
  client: DailyCloseDb = db,
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

  await client.insert(orgNotifications).values({
    orgId,
    title: `Trading day closed — ${tradingDay}`,
    message: lines.join(" "),
    severity: "info",
    source: "daily_close",
    metadata: { tradingDay, ...totals },
  });

  if (totals.uncountedDrawers > 0) {
    await client.insert(orgNotifications).values({
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
    const targetDay = lastClosedTradingDay(timeZone, now);
    const days = await dueTradingDays(org.id, targetDay);
    for (const day of days) {
      try {
        const result = await closeTradingDay(org.id, day, timeZone);
        if (!result.alreadyRun) results.push(result);
      } catch (error) {
        console.error("[DailyClose] Failed for org", org.id, day, error);
      }
    }
  }
  return results;
}

async function dueTradingDays(orgId: string, targetDay: string): Promise<string[]> {
  const [latest] = await db
    .select({ day: sql<string | null>`MAX(${dailyCloseRuns.tradingDay})::text` })
    .from(dailyCloseRuns)
    .where(eq(dailyCloseRuns.orgId, orgId));

  const lastClosed = latest?.day ?? null;
  if (!lastClosed) return [targetDay];
  if (lastClosed >= targetDay) return [];

  const days: string[] = [];
  for (let day = shiftIsoDate(lastClosed, 1); day <= targetDay; day = shiftIsoDate(day, 1)) {
    days.push(day);
  }
  return days;
}
