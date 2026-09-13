/**
 * The words on a card's clock and chip.
 *
 * `deriveCardState` (shared/orders/opsState.ts) decides WHICH state a card is
 * in; this module decides what that state READS like — the big ticking clock,
 * its minute-granular accessible name, and the chip's text. The two are kept
 * apart because the state rule is shared with the server (alerts, reports) and
 * must stay free of formatting, while these strings are the tablet's alone.
 *
 * Everything here is pure and takes `now`, so every label has an exact test
 * (see __tests__/opsClock.test.ts) rather than a snapshot taken at whatever
 * second the suite happened to run — the convention the brief sets out in its
 * test matrix ("pure functions take `now`").
 *
 * Two rules from the brief shape the API:
 *   - The clock is `role="timer"` with a MINUTE-granular `aria-label`. A
 *     second-by-second live region would read the whole board aloud once a
 *     second; the text ticks, the announcement does not.
 *   - A card in a state with no clock (yesterday's, and tomorrow's) returns
 *     null rather than a zero — "0:00" on a pre-order for Friday is a lie
 *     that looks like an emergency.
 */
import type { DerivedCardState, OpsOrderInput } from "@shared/orders/opsState";

export interface OpsClockText {
  /** What the big tabular clock shows, e.g. "late by 4:12". */
  text: string;
  /** What a screen reader announces, rounded to whole minutes. */
  ariaLabel: string;
}

/**
 * A span of time as a counter: "4:12", or "1:02:03" once it passes an hour.
 * Never negative — a tablet clock a few seconds ahead of the server would
 * otherwise render "-0:03" on a brand new order.
 */
export function formatClockSpan(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
  return `${minutes}:${ss}`;
}

/** "4 minutes" / "1 minute" / "less than a minute" — for spoken labels only. */
export function formatSpokenSpan(milliseconds: number): string {
  const totalMinutes = Math.floor(Math.max(0, milliseconds) / 60_000);
  if (totalMinutes < 1) return "less than a minute";
  if (totalMinutes < 60) return `${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hourPart = `${hours} hour${hours === 1 ? "" : "s"}`;
  return minutes === 0 ? hourPart : `${hourPart} ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** A wall-clock time in the organisation's timezone, e.g. "14:30". */
export function formatTimeOfDay(value: Date | string | null | undefined, timeZone: string): string {
  if (value == null) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

/** A day for the Scheduled chip, e.g. "FRI 12 SEP". */
export function formatDayChip(value: Date | string, timeZone: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  })
    .format(date)
    .replace(/,/g, "")
    .toUpperCase();
}

/** A stage stamp as a Date, or null — the board's rows carry ISO strings. */
function stampAt(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The big clock, per the state table in the brief ("Card state —
 * deriveCardState, first match wins"). Returns null for the three states that
 * deliberately have no clock: completed with no recorded handover, yesterday's
 * carried-over cards, and pre-orders still waiting for their day.
 *
 * Takes the order as well as its derived state because the stage stamps
 * (`held_at`, `ready_at`, `customer_arrived_at`) are what three of the clocks
 * count from, and `deriveCardState` deliberately returns a decision rather
 * than a copy of the row.
 */
export function cardClock(
  order: OpsOrderInput,
  derived: DerivedCardState,
  now: Date,
  timeZone: string,
): OpsClockText | null {
  const sinceReceived = now.getTime() - derived.receivedAt.getTime();
  const untilDue = derived.dueEffective.getTime() - now.getTime();
  const pastDue = -untilDue;

  switch (derived.state) {
    case "completed": {
      if (!derived.handoverAt) return null;
      const took = derived.handoverAt.getTime() - derived.receivedAt.getTime();
      return {
        text: `Done ${formatTimeOfDay(derived.handoverAt, timeZone)} · took ${formatClockSpan(took)}`,
        ariaLabel: `Completed at ${formatTimeOfDay(derived.handoverAt, timeZone)}, ${formatSpokenSpan(took)} after it came in`,
      };
    }
    // Yesterday's and tomorrow's cards carry no clock at all: they are not
    // being worked now, and a running counter on one reads as an emergency.
    case "carried-over":
    case "scheduled":
      return null;
    case "held": {
      // `held_at` arrives with migration 065 (N2). Until then an order put on
      // hold has no stamp to count from, so the card falls back to how long
      // it has been in the building — which is still true, and still useful.
      const heldSince = stampAt(order.heldAt);
      const held = heldSince ? now.getTime() - heldSince.getTime() : sinceReceived;
      return { text: `held ${formatClockSpan(held)}`, ariaLabel: `Held for ${formatSpokenSpan(held)}` };
    }
    case "customer-waiting": {
      const arrivedAt = stampAt(order.customerArrivedAt);
      const waiting = arrivedAt ? now.getTime() - arrivedAt.getTime() : sinceReceived;
      return {
        text: `waiting ${formatClockSpan(waiting)}`,
        ariaLabel: `Customer waiting ${formatSpokenSpan(waiting)}`,
      };
    }
    case "late": {
      // With a promise, the useful number is how far past it we are. Without
      // one there is nothing to be late against, so the card counts up from
      // when the order came in and says so in words on the chip.
      if (derived.dueSource === "promise") {
        return {
          text: `late by ${formatClockSpan(pastDue)}`,
          ariaLabel: `Late by ${formatSpokenSpan(pastDue)}`,
        };
      }
      return {
        text: formatClockSpan(sinceReceived),
        ariaLabel: `Waiting ${formatSpokenSpan(sinceReceived)}, no time given`,
      };
    }
    case "delayed": {
      return {
        text: `new time in ${formatClockSpan(untilDue)}`,
        ariaLabel: `New time in ${formatSpokenSpan(untilDue)}`,
      };
    }
    case "ready": {
      if (derived.onTheRoad) {
        return {
          text: `ETA in ${formatClockSpan(untilDue)}`,
          ariaLabel: `Estimated arrival in ${formatSpokenSpan(untilDue)}`,
        };
      }
      const readyAt = stampAt(order.readyAt);
      const ready = readyAt ? now.getTime() - readyAt.getTime() : sinceReceived;
      return { text: `ready ${formatClockSpan(ready)}`, ariaLabel: `Ready for ${formatSpokenSpan(ready)}` };
    }
    case "due-soon":
      return {
        text: `due in ${formatClockSpan(untilDue)}`,
        ariaLabel: `Due in ${formatSpokenSpan(untilDue)}`,
      };
    case "on-time":
    default: {
      if (derived.dueSource === "promise") {
        return {
          text: `due in ${formatClockSpan(untilDue)}`,
          ariaLabel: `Due in ${formatSpokenSpan(untilDue)}`,
        };
      }
      return {
        text: formatClockSpan(sinceReceived),
        ariaLabel: `Waiting ${formatSpokenSpan(sinceReceived)}, no time given`,
      };
    }
  }
}

/**
 * The chip's words. Every state has them: the colour is the first signal, the
 * chip is the one that survives a colour-blind operator, a glare-lit screen
 * and a screen reader (brief, "Colour resolution").
 */
export function cardChipText(
  order: OpsOrderInput,
  derived: DerivedCardState,
  now: Date,
  timeZone: string,
): string {
  switch (derived.state) {
    case "completed":
      return "DONE";
    case "carried-over":
      return "YESTERDAY";
    case "scheduled":
      // The day it is FOR, which for a pre-order is `created_at` — not when
      // somebody keyed it in, which may be a fortnight earlier.
      return `FOR ${formatDayChip(derived.dueAt ?? order.createdAt, timeZone)}`;
    case "held":
      return "HELD";
    case "customer-waiting":
      return "CUSTOMER WAITING";
    case "late":
      return derived.dueSource === "promise"
        ? `LATE ${formatClockSpan(now.getTime() - derived.dueEffective.getTime())}`
        : "OVERDUE · NO TIME GIVEN";
    case "delayed":
      return "DELAYED";
    case "ready":
      return derived.onTheRoad ? "ON THE ROAD" : "READY";
    case "due-soon":
      return "DUE SOON";
    case "on-time":
    default:
      return derived.dueSource === "promise" ? "ON TIME" : "NO TIME GIVEN";
  }
}

/**
 * The small secondary clock: how long since the order came in. Shown on every
 * state except the three that have no clocks at all, because "how long has
 * this been here" is the question the old list answered and the board must
 * not lose.
 */
export function elapsedSinceReceived(derived: DerivedCardState, now: Date): string | null {
  if (derived.state === "completed" || derived.state === "carried-over" || derived.state === "scheduled") {
    return null;
  }
  return formatClockSpan(now.getTime() - derived.receivedAt.getTime());
}
