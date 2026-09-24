import type { CreditRuleFailure } from "./creditPolicy";

/**
 * "This customer already owes" at order start (v1.2.1 credit).
 *
 * When staff start an order for a customer with a Credit List balance, the
 * till says so: how much, over how many tabs, and since when. It never blocks
 * the sale. The Credit List itself is manager and above (Q11), so what reaches
 * a cashier is this customer's total, tab count and oldest date — nothing about
 * other customers, no order numbers, no contact details.
 *
 * Take a payment records a repayment from the same screen, through the
 * existing per-customer repayment path (oldest tab first), so the ledger,
 * expected cash, the shift summary and commission all follow as they already
 * do. At the till it is cash or card, today, and can be part of the balance.
 */

export const CUSTOMER_CREDIT_MIN_ROLE = "CASHIER" as const;

export type CustomerCreditSummary = {
  customerId: string;
  /** What is still owed across every open tab, in pounds. */
  owed: number;
  /** How many credit sales still have money outstanding. */
  tabs: number;
  /** The trading day the oldest open tab was given (YYYY-MM-DD), or null. */
  oldestGivenOn: string | null;
};

const round = (n: number) => Math.round(n * 100) / 100;

/** Summarises a customer's open credit rows. Settled, voided and written-off rows are left out by the caller. */
export function summariseCustomerCredit(
  customerId: string,
  rows: Array<{ amountOutstanding: string | number | null; givenOn: string | null }>,
): CustomerCreditSummary {
  const open = rows.filter((r) => round(Number(r.amountOutstanding ?? 0)) > 0);
  const owed = round(open.reduce((sum, r) => sum + Number(r.amountOutstanding ?? 0), 0));
  const dates = open.map((r) => r.givenOn).filter((d): d is string => !!d).sort();
  return { customerId, owed, tabs: open.length, oldestGivenOn: dates[0] ?? null };
}

/** At the till the money is in hand: cash or card. A bank transfer is recorded from the Credit List. */
export const TILL_CREDIT_PAYMENT_METHODS = ["cash", "card"] as const;
export type TillCreditPaymentMethod = (typeof TILL_CREDIT_PAYMENT_METHODS)[number];

/**
 * Checks a till repayment before it reaches the ledger. The amount must be
 * more than zero, in whole pence and no more than the customer owes; the
 * method must be chosen (cash or card), because a cash payment raises the
 * drawer's expected cash and a card one must not. The till never backdates.
 */
export function checkTillCreditPayment(
  body: { amount?: unknown; method?: unknown; paidOn?: unknown } | undefined,
  owed: number,
): { ok: true; amount: number; method: TillCreditPaymentMethod } | CreditRuleFailure {
  const raw = body?.amount;
  const amount = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, status: 400, code: "CREDIT_AMOUNT_INVALID", message: "Enter how much the customer paid." };
  }
  if (Math.abs(round(amount) - amount) > 1e-9) {
    return { ok: false, status: 400, code: "CREDIT_AMOUNT_INVALID", message: "Enter the amount in pounds and pence." };
  }
  const method = typeof body?.method === "string" ? body.method.trim().toLowerCase() : "";
  if (!method) {
    return { ok: false, status: 400, code: "CREDIT_METHOD_REQUIRED", message: "Choose how the customer paid: cash or card." };
  }
  if (!(TILL_CREDIT_PAYMENT_METHODS as readonly string[]).includes(method)) {
    return {
      ok: false,
      status: 400,
      code: "CREDIT_METHOD_INVALID",
      message: "At the till a payment is cash or card. Record a bank transfer from the Credit List.",
    };
  }
  if (body?.paidOn !== undefined && body?.paidOn !== null && body?.paidOn !== "") {
    return {
      ok: false,
      status: 400,
      code: "CREDIT_BACKDATE_AT_TILL",
      message: "A payment taken at the till is today's. Backdate one from the Credit List.",
    };
  }
  if (!(owed > 0)) {
    return { ok: false, status: 409, code: "CREDIT_NOTHING_OWED", message: "This customer owes nothing on credit." };
  }
  if (round(amount) > round(owed)) {
    return {
      ok: false,
      status: 400,
      code: "CREDIT_OVERPAYMENT",
      message: `That is more than this customer owes. £${round(owed).toFixed(2)} is outstanding.`,
    };
  }
  return { ok: true, amount: round(amount), method: method as TillCreditPaymentMethod };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];

/** 2026-09-03 → "3 Sept 2026". A plain calendar date: no time zone is involved. */
export function formatCreditDate(iso: string | null): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** What the till says. Null when nothing is owed, so nothing is shown. */
export function customerCreditNotice(
  summary: Pick<CustomerCreditSummary, "owed" | "tabs" | "oldestGivenOn"> | null | undefined,
): { headline: string; detail: string; reminder: string } | null {
  if (!summary || !(round(summary.owed) > 0) || summary.tabs <= 0) return null;
  const tabs = summary.tabs === 1 ? "1 tab" : `${summary.tabs} tabs`;
  const since = formatCreditDate(summary.oldestGivenOn);
  const oldest = since ? (summary.tabs === 1 ? `, from ${since}` : `, the oldest from ${since}`) : "";
  return {
    headline: `This customer already owes £${round(summary.owed).toFixed(2)}`,
    detail: `On ${tabs}${oldest}.`,
    reminder: "If they pay anything towards it, record it against their credit with Take a payment. The sale can go ahead either way.",
  };
}
