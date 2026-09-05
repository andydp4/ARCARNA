/**
 * Dating an order for a day other than today — the server half.
 *
 * The rules (window, what counts as live, where the stamp lands in the day)
 * live in shared/orders/orderDate.ts so the till can apply them before the
 * request is sent. This module is what turns a verdict into rows: the instant
 * the order is stamped with, and which cashier shift it belongs to.
 *
 * A backdated order is treated the way an offline order replayed after its
 * shift closed already is: it belongs to the shift of the day it was sold on,
 * not the day it was keyed in. That is the shift whose summary and commission
 * ledger must carry it, and the shift engine already knows how to take a late
 * arrival into a closed shift (`refreshClosedCashierShiftSummary`). A whole
 * missed day usually has no shift at all, because shifts open on first sale —
 * so one is opened for that day and closed straight after, exactly as the
 * 06:00 close would have done had the sales been keyed in on time.
 */
import type { CashierShift } from "@shared/schema";
import {
  classifyOrderDate,
  instantForOrderDate,
  todayIn,
  type OrderDating,
} from "@shared/orders/orderDate";
import { currentTradingDay } from "@shared/time/tradingDay";
import { orgTimeZone, resolveShiftForToday } from "./tradingDayShift";
import { closeCashierShift, refreshClosedCashierShiftSummary } from "./cashierShiftEngine";

export type ResolvedOrderDating =
  | {
      ok: true;
      dating: OrderDating;
      /** The stamp for `created_at`, or null for a live sale (leave the default). */
      instant: Date | null;
      timeZone: string;
    }
  | { ok: false; code: "ORDER_DATE_INVALID" | "ORDER_DATE_OUT_OF_RANGE"; message: string };

/** Checks an order date against today in the org's own zone and, if dated, fixes the instant. */
export async function resolveOrderDating(
  orgId: string,
  orderDate: unknown,
  now: Date = new Date(),
): Promise<ResolvedOrderDating> {
  // No date at all is the ordinary sale, and it costs nothing: the org's zone
  // only matters once there is a date to place in it.
  if (orderDate === undefined || orderDate === null || orderDate === "") {
    return { ok: true, dating: { kind: "live", date: todayIn("UTC", now) }, instant: null, timeZone: "UTC" };
  }
  const timeZone = await orgTimeZone(orgId);
  const verdict = classifyOrderDate(orderDate, todayIn(timeZone, now));
  if (!verdict.ok) return verdict;
  const instant =
    verdict.dating.kind === "live" ? null : instantForOrderDate(verdict.dating.date, timeZone);
  return { ok: true, dating: verdict.dating, instant, timeZone };
}

/**
 * The cashier shift a backdated order belongs to: the user's shift for the
 * trading day the order is dated on, opened if the day never had one.
 */
export async function cashierShiftForBackdatedOrder(
  orgId: string,
  userId: string,
  instant: Date,
): Promise<CashierShift | null> {
  return resolveShiftForToday(orgId, userId, instant);
}

/**
 * Brings a past day's shift up to date after a backdated order landed in it.
 *
 * A shift still open for a day that has already had its 06:00 close is one we
 * just opened to hold the order, so it is closed here (the daily close will not
 * come back for it — its run for that day is already recorded). One that was
 * closed on the night has its summary and commission ledger refreshed, which
 * is idempotent and only ever adds what has newly arrived. A shift for the
 * trading day still in progress is left to the ordinary close.
 */
export async function settleBackdatedShift(
  orgId: string,
  shift: Pick<CashierShift, "id" | "status" | "tradingDay">,
  now: Date = new Date(),
): Promise<void> {
  const timeZone = await orgTimeZone(orgId);
  if (!shift.tradingDay || shift.tradingDay >= currentTradingDay(timeZone, now)) return;
  if (shift.status === "open") {
    await closeCashierShift(orgId, shift.id, {
      closedByUserId: null,
      closeReason: "backdated_entry",
    });
    return;
  }
  await refreshClosedCashierShiftSummary(orgId, shift.id);
}
