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

export interface RotaDay {
  date: string;
  status: RotaDayStatus;
  startTime: string | null;
  endTime: string | null;
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
    return {
      date,
      status: override.status === "off" ? "off" : "working",
      startTime: override.status === "working" ? override.startTime : null,
      endTime: override.status === "working" ? override.endTime : null,
      isOverride: true,
    };
  }

  const dow = isoDow(date);
  const pattern = patterns.find(
    (p) =>
      p.isActive !== 0 &&
      p.dayOfWeek === dow &&
      p.effectiveFrom <= date &&
      (!p.effectiveUntil || p.effectiveUntil >= date),
  );
  if (pattern) {
    return { date, status: "working", startTime: pattern.startTime, endTime: pattern.endTime, isOverride: false };
  }

  return { date, status: "unscheduled", startTime: null, endTime: null, isOverride: false };
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
