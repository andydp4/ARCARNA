/**
 * Staff Performance, Fairness (v1.2 Phase 7C, STF-06) — rates, not totals.
 *
 * A part-timer who works two days cannot load as many orders as someone who
 * works six, so comparing totals is unfair. Rates put everyone on the same
 * footing: per active hour, per day worked, and per 10 orders.
 *
 * **Active hours** come from each person's existing daily shift record (the
 * lazy shift opened on their first action of the trading day): first to last
 * action, plus 10 minutes for the work around the last tap, capped at 12
 * hours so a shift left open overnight does not read as a 20-hour day.
 * Nothing new is recorded about anyone to get this.
 *
 * Only the rates carry a colour (a target, `staffTargets.ts`); totals stay
 * plain, because a total mostly measures how long someone worked.
 */

export const ACTIVE_TAIL_MINUTES = 10;
export const ACTIVE_CAP_HOURS = 12;

export interface ShiftSpan {
  tradingDay: string;
  /** First action (the shift opened on it). */
  openedAt: Date;
  /** Last action. */
  lastActivityAt: Date;
}

/** Active hours for one daily shift: first to last action + 10 minutes, capped at 12 hours. */
export function activeHoursForShift(openedAt: Date, lastActivityAt: Date): number {
  const minutes = Math.max(0, (lastActivityAt.getTime() - openedAt.getTime()) / 60_000) + ACTIVE_TAIL_MINUTES;
  return Math.min(minutes / 60, ACTIVE_CAP_HOURS);
}

/**
 * Active time over many shift rows. A trading day can hold more than one row
 * (a closed lazy shift reopens on the next sale), so the rule is applied once
 * per day: earliest opening to latest action, one 10-minute tail, one 12-hour
 * cap. Summing per row would double the tail and cap and understate rates.
 */
export function activeTime(shifts: readonly ShiftSpan[]): { activeHours: number; daysWorked: number } {
  const byDay = new Map<string, { first: Date; last: Date }>();
  for (const s of shifts) {
    const d = byDay.get(s.tradingDay);
    if (!d) {
      byDay.set(s.tradingDay, { first: s.openedAt, last: s.lastActivityAt });
      continue;
    }
    if (s.openedAt.getTime() < d.first.getTime()) d.first = s.openedAt;
    if (s.lastActivityAt.getTime() > d.last.getTime()) d.last = s.lastActivityAt;
  }
  let hours = 0;
  for (const d of byDay.values()) hours += activeHoursForShift(d.first, d.last);
  return { activeHours: Math.round(hours * 100) / 100, daysWorked: byDay.size };
}

export interface FairnessInput {
  activeHours: number;
  daysWorked: number;
  /** Distinct counted orders they did any job on. */
  ordersHandled: number;
  /** Loaded + prepared + completed + dispatched. */
  jobs: number;
  completed: number;
  valueBroughtIn: number;
  refundsProcessed: number;
  reopens: number;
  deletes: number;
  unreadyTaps: number;
  wrongItemOrders: number;
}

export interface FairnessRates {
  activeHours: number;
  daysWorked: number;
  ordersHandled: number;
  jobsPerActiveHour: number | null;
  ordersPerActiveHour: number | null;
  valuePerActiveHour: number | null;
  jobsPerDay: number | null;
  valuePerDay: number | null;
  refundsPer10Orders: number | null;
  reopensPer10Orders: number | null;
  deletesPer10Orders: number | null;
  unreadyPer10Orders: number | null;
  wrongItemsPer10Orders: number | null;
}

const per = (n: number, d: number, scale = 1) => (d > 0 ? (n / d) * scale : null);

export function fairnessRates(i: FairnessInput): FairnessRates {
  return {
    activeHours: i.activeHours,
    daysWorked: i.daysWorked,
    ordersHandled: i.ordersHandled,
    jobsPerActiveHour: per(i.jobs, i.activeHours),
    ordersPerActiveHour: per(i.ordersHandled, i.activeHours),
    valuePerActiveHour: per(i.valueBroughtIn, i.activeHours),
    jobsPerDay: per(i.jobs, i.daysWorked),
    valuePerDay: per(i.valueBroughtIn, i.daysWorked),
    refundsPer10Orders: per(i.refundsProcessed, i.ordersHandled, 10),
    reopensPer10Orders: per(i.reopens, i.ordersHandled, 10),
    deletesPer10Orders: per(i.deletes, i.ordersHandled, 10),
    unreadyPer10Orders: per(i.unreadyTaps, i.ordersHandled, 10),
    wrongItemsPer10Orders: per(i.wrongItemOrders, i.ordersHandled, 10),
  };
}

/** Q14: a team median is shown only when the team has at least this many people. */
export const TEAM_MEDIAN_MIN_PEOPLE = 4;

/** The median of the team's values, or null when fewer than 4 people have one (so nobody can be worked out). */
export function teamMedian(values: ReadonlyArray<number | null | undefined>, minPeople = TEAM_MEDIAN_MIN_PEOPLE): number | null {
  const present = values.filter((v): v is number => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (present.length < minPeople) return null;
  const mid = Math.floor(present.length / 2);
  return present.length % 2 ? present[mid] : (present[mid - 1] + present[mid]) / 2;
}
