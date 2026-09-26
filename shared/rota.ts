import type { ShiftOverride, ShiftPattern } from "./schema";

/**
 * Resolves what one person is rota'd for on one date.
 *
 * An override for that exact date always wins — a manager's one-off cover
 * or swap, or (status "off") the effect of an approved time-off request.
 * Otherwise the pattern whose day-of-week matches and whose effective range
 * covers the date applies. No override and no matching pattern means
 * "unscheduled" — not the same as "off": nobody has said anything about
 * that day for that person yet.
 */
export type RotaDayStatus = "working" | "off" | "unscheduled";

/** One shift within a day — a person can have more than one (a split shift, or an overnight-plus-evening double). */
export interface RotaShiftSegment {
  startTime: string;
  endTime: string;
}

export interface RotaDay {
  date: string;
  status: RotaDayStatus;
  /** The earliest shift's start, or the only shift's — kept for simple display. Use `shifts` for the full picture. */
  startTime: string | null;
  /** The latest shift's end, or the only shift's. */
  endTime: string | null;
  /** Every shift this person has on this date, sorted by start time. Empty when off or unscheduled. */
  shifts: RotaShiftSegment[];
  /** Set when a manager's override (not a pattern, not a time-off approval) produced this day. */
  isOverride: boolean;
}

function isoDow(date: string): number {
  // date is "YYYY-MM-DD"; Date.UTC avoids the local-timezone-off-by-one a
  // bare `new Date(date)` risks near midnight.
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function resolvePersonDay(
  date: string,
  patterns: Pick<ShiftPattern, "dayOfWeek" | "startTime" | "endTime" | "effectiveFrom" | "effectiveUntil" | "isActive">[],
  overrides: Pick<ShiftOverride, "date" | "status" | "startTime" | "endTime">[],
): RotaDay {
  const override = overrides.find((o) => o.date === date);
  if (override) {
    const working = override.status === "working";
    return {
      date,
      status: override.status === "off" ? "off" : "working",
      startTime: working ? override.startTime : null,
      endTime: working ? override.endTime : null,
      shifts: working && override.startTime && override.endTime ? [{ startTime: override.startTime, endTime: override.endTime }] : [],
      isOverride: true,
    };
  }

  const dow = isoDow(date);
  // Every matching pattern, not just the first — a person can be down for
  // more than one shift the same day (a split shift, or an overnight shift
  // plus a separate evening one).
  const dayPatterns = patterns
    .filter(
      (p) =>
        p.isActive !== 0 &&
        p.dayOfWeek === dow &&
        p.effectiveFrom <= date &&
        (!p.effectiveUntil || p.effectiveUntil >= date),
    )
    .map((p) => ({ startTime: p.startTime, endTime: p.endTime }))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  if (dayPatterns.length > 0) {
    return {
      date,
      status: "working",
      startTime: dayPatterns[0].startTime,
      endTime: dayPatterns[dayPatterns.length - 1].endTime,
      shifts: dayPatterns,
      isOverride: false,
    };
  }

  return { date, status: "unscheduled", startTime: null, endTime: null, shifts: [], isOverride: false };
}

/** Every date's resolved day for one person, in order. */
export function resolvePersonRota(
  dates: string[],
  patterns: Pick<ShiftPattern, "dayOfWeek" | "startTime" | "endTime" | "effectiveFrom" | "effectiveUntil" | "isActive">[],
  overrides: Pick<ShiftOverride, "date" | "status" | "startTime" | "endTime">[],
): RotaDay[] {
  return dates.map((date) => resolvePersonDay(date, patterns, overrides));
}

/** The next N dates as "YYYY-MM-DD", starting from (and including) `from`. */
export function forwardDates(from: string, days: number): string[] {
  const [y, m, d] = from.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    out.push(dt.toISOString().slice(0, 10));
  }
  return out;
}

/** How many people are working at some point on this date, across a roster. */
export function headcountFor(date: string, rotaByUser: Map<string, RotaDay[]>, dateIndex: number): number {
  let count = 0;
  for (const days of rotaByUser.values()) {
    if (days[dateIndex]?.status === "working") count++;
  }
  return count;
}
