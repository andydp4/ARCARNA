import type { Role } from "./rbac";
import { isAtLeast } from "./accessPolicy";
import { BACKDATE_LIMIT_DAYS, isIsoDate } from "./orders/orderDate";
import { shiftIsoDate } from "./time/tradingDay";

/**
 * Credit (tick), invoices and gift cards (v1.2 Phase 0B, FIX-12 / FIX-13;
 * owner decision Q11).
 *
 * The Credit List and Invoices are manager and above, on the menu and on the
 * server: a cashier cannot reach a credit endpoint at all. The rules below
 * still hold for the managers who can, so they are written as if anyone might
 * call them.
 */

export const CREDIT_MIN_ROLE: Role = "MANAGER";
export const GIFT_CARD_ISSUE_MIN_ROLE: Role = "MANAGER";

/** How a credit payment arrived. Anything else is refused, not stored. */
export const CREDIT_PAYMENT_METHODS = ["cash", "card", "transfer"] as const;
export type CreditPaymentMethod = (typeof CREDIT_PAYMENT_METHODS)[number];

export type CreditRuleFailure = { ok: false; status: 400 | 403 | 409; code: string; message: string };

/** The method named, lower-cased. Nothing sent means cash, as it always has. */
export function parseCreditPaymentMethod(raw: unknown): { ok: true; method: CreditPaymentMethod } | CreditRuleFailure {
  if (raw === undefined || raw === null || raw === "") return { ok: true, method: "cash" };
  const method = String(raw).trim().toLowerCase();
  if ((CREDIT_PAYMENT_METHODS as readonly string[]).includes(method)) {
    return { ok: true, method: method as CreditPaymentMethod };
  }
  return {
    ok: false,
    status: 400,
    code: "CREDIT_METHOD_INVALID",
    message: `Payment method must be one of: ${CREDIT_PAYMENT_METHODS.join(", ")}.`,
  };
}

/**
 * "Clear account" settles a whole tab in one go, so how the money came in has
 * to be said rather than assumed (v1.2 Phase 1C): a cash clear goes into the
 * drawer's expected cash, a card or transfer one does not, and defaulting to
 * cash would put money in the drawer that was never there.
 */
export function requireCreditPaymentMethod(raw: unknown): { ok: true; method: CreditPaymentMethod } | CreditRuleFailure {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return {
      ok: false,
      status: 400,
      code: "CREDIT_METHOD_REQUIRED",
      message: "Choose how the customer paid (Paid by) before clearing the account.",
    };
  }
  return parseCreditPaymentMethod(raw);
}

/**
 * Card and transfer money never passes through the till drawer, so nothing
 * at the close would catch one recorded that never arrived. When it is
 * recorded by anyone below admin, the people above them get a Signal.
 */
export function creditPaymentNeedsSignal(method: CreditPaymentMethod, recorderRole: string | null | undefined): boolean {
  return (method === "card" || method === "transfer") && !isAtLeast(recorderRole, "ADMIN");
}

/**
 * The date a credit payment is recorded against. Nothing, or today, is
 * today. Earlier is a backdate: managers only, and only within the same
 * window an order may be backdated (BACKDATE_LIMIT_DAYS). Never the future:
 * money that has not arrived is not a payment.
 *
 * Returns `paidOn: null` for today, so the ledger stamps the org's own
 * trading day exactly as it did before.
 */
export function checkCreditPaidOn(
  paidOn: unknown,
  today: string,
  recorderRole: string | null | undefined,
): { ok: true; paidOn: string | null } | CreditRuleFailure {
  if (paidOn === undefined || paidOn === null || paidOn === "") return { ok: true, paidOn: null };
  if (!isIsoDate(paidOn)) {
    return { ok: false, status: 400, code: "CREDIT_DATE_INVALID", message: "The payment date must be a calendar date, like 2026-09-03." };
  }
  if (paidOn === today) return { ok: true, paidOn: null };
  if (paidOn > today) {
    return { ok: false, status: 400, code: "CREDIT_DATE_FUTURE", message: "A payment cannot be dated in the future." };
  }
  if (!isAtLeast(recorderRole, "MANAGER")) {
    return { ok: false, status: 403, code: "CREDIT_BACKDATE_FORBIDDEN", message: "Only a manager can backdate a payment." };
  }
  const min = shiftIsoDate(today, -BACKDATE_LIMIT_DAYS);
  if (paidOn < min) {
    return {
      ok: false,
      status: 400,
      code: "CREDIT_DATE_OUT_OF_RANGE",
      message: `A payment can be dated at most ${BACKDATE_LIMIT_DAYS} days back (${min} or later).`,
    };
  }
  return { ok: true, paidOn };
}

/**
 * Clearing a customer's whole account needs the exact balance the person
 * clearing it was looking at. If more went on the tab since the screen
 * loaded, "clear it" would settle money nobody agreed to.
 */
export function checkClearWholeTab(expectedBalance: unknown, owed: number): { ok: true } | CreditRuleFailure {
  const expected = Number(expectedBalance);
  if (expectedBalance === undefined || expectedBalance === null || expectedBalance === "" || !Number.isFinite(expected)) {
    return {
      ok: false,
      status: 400,
      code: "CREDIT_BALANCE_REQUIRED",
      message: "Send the balance being cleared, so a tab that has changed is not cleared by mistake.",
    };
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  if (round(expected) !== round(owed)) {
    return {
      ok: false,
      status: 409,
      code: "CREDIT_BALANCE_CHANGED",
      message: `The balance has changed. £${round(owed).toFixed(2)} is now outstanding.`,
    };
  }
  return { ok: true };
}

/** A gift card is issued with a reason: it is money out of the business. */
export const GIFT_CARD_REASON_MIN = 3;
export const GIFT_CARD_REASON_MAX = 500;
