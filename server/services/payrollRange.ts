import { and, eq, gte, isNull, lt, lte, or } from "drizzle-orm";
import { db } from "../db";
import { cashierShifts } from "../../shared/schema";
import { currentTradingDay, shiftIsoDate, tradingDayBounds } from "@shared/time/tradingDay";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The trading days a payroll request covers, inclusive, and their instant span. */
export function tradingDayRange(query: Record<string, unknown>, timeZone: string) {
  const today = currentTradingDay(timeZone);
  const day = (v: unknown) => (typeof v === "string" && ISO_DAY.test(v.slice(0, 10)) ? v.slice(0, 10) : null);
  const toIso = day(query.to) ?? today;
  const fromIso = day(query.from) ?? shiftIsoDate(toIso, -30);
  return {
    fromIso,
    toIso,
    start: tradingDayBounds(fromIso, timeZone).start,
    end: tradingDayBounds(toIso, timeZone).end,
  };
}

export type TradingDayRange = ReturnType<typeof tradingDayRange>;

/**
 * The shifts a payroll range covers: by trading day, or by when they opened for
 * shifts from before trading days existed (migration 058). The table and the
 * CSV both select through this so their totals cannot disagree.
 */
export function shiftsInRange(orgId: string, range: TradingDayRange) {
  return db
    .select()
    .from(cashierShifts)
    .where(
      and(
        eq(cashierShifts.orgId, orgId),
        or(
          and(gte(cashierShifts.tradingDay, range.fromIso), lte(cashierShifts.tradingDay, range.toIso)),
          and(isNull(cashierShifts.tradingDay), gte(cashierShifts.openedAt, range.start), lt(cashierShifts.openedAt, range.end)),
        ),
      ),
    );
}

