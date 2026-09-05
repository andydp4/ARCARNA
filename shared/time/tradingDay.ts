/**
 * The trading day.
 *
 * A shift is not a login session — it is one person's trading day, and a
 * trading day runs from 06:00 to 06:00 in the organisation's own timezone.
 * Logging out for a break and back in returns to the same day; only the 06:00
 * cut ends it.
 *
 * Everything here works in the org's timezone rather than UTC, and that is the
 * whole point of the module. The shift engine used to bucket orders by UTC
 * calendar date, which is wrong twice over for a 06:00 local cut: it puts
 * everything sold between midnight and 06:00 in the wrong day, and in Europe/
 * London it drifts by an hour for the seven months of British Summer Time.
 */

/** Trading days begin at 06:00 local. Before that, you are still on yesterday. */
export const TRADING_DAY_START_HOUR = 6;

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function partsIn(instant: Date, timeZone: string): Parts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    // h23 rather than h12 or the default: some locales render midnight as "24",
    // which would read as hour 24 and push the date forward by a day.
    hourCycle: "h23",
  });
  const found: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") found[part.type] = part.value;
  }
  return {
    year: Number(found.year),
    month: Number(found.month),
    day: Number(found.day),
    hour: Number(found.hour),
    minute: Number(found.minute),
    second: Number(found.second),
  };
}

/** How far the zone is from UTC at a given instant, in milliseconds. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const p = partsIn(instant, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - instant.getTime();
}

function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The date `days` away from an ISO date, without touching timezones. */
export function shiftIsoDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const moved = new Date(Date.UTC(y, m - 1, d + days));
  return isoDate(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

/**
 * Which trading day an instant belongs to, as an ISO date.
 *
 * 05:59 on the 12th is still the 11th's trading day; 06:01 is the 12th's.
 */
export function tradingDayFor(instant: Date, timeZone: string): string {
  const p = partsIn(instant, timeZone);
  const localDate = isoDate(p.year, p.month, p.day);
  return p.hour < TRADING_DAY_START_HOUR ? shiftIsoDate(localDate, -1) : localDate;
}

/** The calendar date an instant falls on in the zone, as an ISO date. Ignores the 06:00 cut. */
export function localCalendarDate(instant: Date, timeZone: string): string {
  const p = partsIn(instant, timeZone);
  return isoDate(p.year, p.month, p.day);
}

/**
 * The instant a given local hour falls on for a given date.
 *
 * Resolved by correcting a naive UTC guess with the zone's offset, then
 * re-checking: on the two days a year the clocks move, the offset at the guess
 * is not the offset at the answer, and taking the first result would be an hour
 * out on exactly the day it matters most.
 */
export function localInstant(date: string, hour: number, timeZone: string): Date {
  const naive = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00.000Z`);
  const firstGuess = new Date(naive.getTime() - zoneOffsetMs(naive, timeZone));
  const corrected = zoneOffsetMs(firstGuess, timeZone);
  return new Date(naive.getTime() - corrected);
}

/** The instant 06:00 local falls on for a given date. */
function localStartInstant(date: string, timeZone: string): Date {
  return localInstant(date, TRADING_DAY_START_HOUR, timeZone);
}

/**
 * The half-open window a trading day covers: [start, end).
 *
 * End is the next day's start rather than start + 24 hours, so the day the
 * clocks go forward is 23 hours long and the day they go back is 25 — which is
 * what actually happened in the shop.
 */
export function tradingDayBounds(date: string, timeZone: string): { start: Date; end: Date } {
  return {
    start: localStartInstant(date, timeZone),
    end: localStartInstant(shiftIsoDate(date, 1), timeZone),
  };
}

/** The trading day in progress right now. */
export function currentTradingDay(timeZone: string, now: Date = new Date()): string {
  return tradingDayFor(now, timeZone);
}

/**
 * The most recent trading day that has finished.
 *
 * What the daily close totals: at 06:05 on the 12th the day just ended is the
 * 11th, and at 05:55 it is the 10th, because the 11th is still running.
 */
export function lastClosedTradingDay(timeZone: string, now: Date = new Date()): string {
  return shiftIsoDate(currentTradingDay(timeZone, now), -1);
}
