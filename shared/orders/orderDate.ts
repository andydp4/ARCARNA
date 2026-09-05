/**
 * Dating an order.
 *
 * An order is normally dated the moment it is keyed in, and `orders.created_at`
 * is what every report, the daily close and the shift engine read as "when the
 * sale happened". Two things need that date to be something other than now:
 *
 *   - a day's sales that never got entered, being keyed in afterwards; and
 *   - a pre-order, taken today for a date still to come.
 *
 * Either way the order carries the date it is FOR, and `created_at` is set to
 * it, so the sale lands on the right day in every figure without any report
 * needing to know the difference. What is recorded alongside — `entered_at`
 * and `date_kind` — is so the difference is never lost: an order dated last
 * Tuesday and one keyed in last Tuesday are not the same thing to an auditor.
 *
 * The window is deliberately narrow. Seven days back is enough to catch up a
 * missed day or a long weekend without turning the till into a way of quietly
 * rewriting last month; two weeks ahead covers a pre-order without letting an
 * order be parked in a future nobody will look at.
 */
import { localCalendarDate, localInstant, shiftIsoDate } from "../time/tradingDay";

/** How far back an order may be dated, in calendar days. */
export const BACKDATE_LIMIT_DAYS = 7;
/** How far ahead an order may be dated, in calendar days. */
export const PREORDER_LIMIT_DAYS = 14;

export const ORDER_DATE_KINDS = ["live", "backdated", "preorder"] as const;
export type OrderDateKind = (typeof ORDER_DATE_KINDS)[number];

/**
 * The local hour a dated order is stamped at.
 *
 * A date on its own is not an instant, and the trading day runs 06:00 to 06:00,
 * so the stamp must sit unambiguously inside the day it names. Noon does; a
 * midnight stamp would put every backdated sale on the previous trading day.
 */
export const DATED_ORDER_HOUR = 12;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** The earliest and latest dates an order may carry, given today's date. */
export function orderDateWindow(today: string): { min: string; max: string } {
  return {
    min: shiftIsoDate(today, -BACKDATE_LIMIT_DAYS),
    max: shiftIsoDate(today, PREORDER_LIMIT_DAYS),
  };
}

export type OrderDating = { kind: OrderDateKind; date: string };

export type OrderDateVerdict =
  | { ok: true; dating: OrderDating }
  | { ok: false; code: "ORDER_DATE_INVALID" | "ORDER_DATE_OUT_OF_RANGE"; message: string };

/**
 * What an order date means relative to today.
 *
 * No date, or today's date, is a live sale — the ordinary case, and the one
 * nothing else about the order needs to know about. Anything else is checked
 * against the window and named for what it is.
 */
export function classifyOrderDate(orderDate: unknown, today: string): OrderDateVerdict {
  if (orderDate === undefined || orderDate === null || orderDate === "") {
    return { ok: true, dating: { kind: "live", date: today } };
  }
  if (!isIsoDate(orderDate)) {
    return {
      ok: false,
      code: "ORDER_DATE_INVALID",
      message: "The order date must be a calendar date, like 2026-09-03.",
    };
  }
  if (orderDate === today) return { ok: true, dating: { kind: "live", date: today } };

  const { min, max } = orderDateWindow(today);
  if (orderDate < min) {
    return {
      ok: false,
      code: "ORDER_DATE_OUT_OF_RANGE",
      message: `An order can be dated at most ${BACKDATE_LIMIT_DAYS} days back (${min} or later).`,
    };
  }
  if (orderDate > max) {
    return {
      ok: false,
      code: "ORDER_DATE_OUT_OF_RANGE",
      message: `A pre-order can be dated at most ${PREORDER_LIMIT_DAYS} days ahead (${max} or earlier).`,
    };
  }
  return {
    ok: true,
    dating: { kind: orderDate < today ? "backdated" : "preorder", date: orderDate },
  };
}

/** Today's calendar date in a zone. This is the calendar, not the trading day. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return localCalendarDate(now, timeZone);
}

/** The instant a dated order is stamped with: noon local on the day it is for. */
export function instantForOrderDate(date: string, timeZone: string): Date {
  return localInstant(date, DATED_ORDER_HOUR, timeZone);
}

/** The browser's own calendar date, for defaulting the form. The server re-checks in the org's zone. */
export function localIsoDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Short label for a badge or hint. Nothing for a live sale, which needs no explaining. */
export function describeOrderDating(kind: OrderDateKind | string | null | undefined): string | null {
  if (kind === "backdated") return "Backdated";
  if (kind === "preorder") return "Pre-order";
  return null;
}
