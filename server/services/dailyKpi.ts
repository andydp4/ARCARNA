import {
  averageSameWeekdayKpi,
  offsetDate,
  sameWeekdayWindow,
  type DailyKpiResponse,
  type DayKpi,
} from "@shared/analytics/kpi";
import { firstSettledDate, settledRevenueByDay } from "./revenue";

/**
 * Today's takings and its comparisons, computed from `orders` via the single
 * revenue definition in ./revenue.ts.
 *
 * This used to read an analytics_daily projection and fall back to a live
 * aggregate only when a row was entirely absent — not when it was stale. So
 * once a row existed for today the card froze at whatever the projection last
 * wrote, and the two sources disagreed about what revenue even meant: the
 * projection counted every order at creation regardless of status, the fallback
 * counted only completed ones and dated them by creation. There is now one
 * source and one definition.
 */
export async function getDailyKpi(orgId: string, date: string): Promise<DailyKpiResponse> {
  const lastWeekDate = offsetDate(date, -7);
  const ltmDates = sameWeekdayWindow(date, 52);

  // One query spanning the whole comparison window rather than one per date.
  const allDates = [date, lastWeekDate, ...ltmDates];
  const minDate = allDates.reduce((min, d) => (d < min ? d : min), allDates[0]);
  const maxDate = allDates.reduce((max, d) => (d > max ? d : max), allDates[0]);

  const [byDay, tradingSince] = await Promise.all([
    settledRevenueByDay(orgId, minDate, maxDate),
    firstSettledDate(orgId),
  ]);

  /**
   * A day the org was trading but took nothing is a real zero and belongs in
   * the average. A day before it ever settled an order is unknown, and must
   * stay null so `averageSameWeekdayKpi` excludes it rather than averaging in
   * a zero the business never had the chance to earn.
   */
  const dayOrNull = (d: string): DayKpi | null => {
    const found = byDay.get(d);
    if (found) return found;
    if (tradingSince === null || d < tradingSince) return null;
    return emptyDay();
  };

  return {
    today: byDay.get(date) ?? emptyDay(),
    lastWeek: dayOrNull(lastWeekDate) ?? emptyDay(),
    sameWeekdayLtmAvg: averageSameWeekdayKpi(ltmDates.map(dayOrNull)),
    date,
  };
}

function emptyDay(): DayKpi {
  return { revenue: 0, txns: 0, aov: 0, refundsTotal: 0 };
}
