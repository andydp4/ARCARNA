/**
 * How much a refund gives back, and which way the money goes (v1.2.1 money).
 *
 * Two rules, both pure so the route, the tests and the figures check agree:
 *
 * 1. A refund gives back what the customer PAID for the items, not their list
 *    price. The sale's settled total is shared across its lines by their
 *    value, so a promotion, tier or points discount on the sale comes off the
 *    refund too, and VAT charged on the items goes back with them. Refunding
 *    every line of a sale gives back exactly what it was settled at, never a
 *    penny more (the last refund takes any rounding).
 *
 * 2. Money goes back the way it came in. A refund on a Credit List (tab) sale
 *    comes off the tab first: the customer never paid for those goods, so
 *    handing them cash would pay them for nothing and leave them still shown
 *    owing. Only what was actually paid is handed back. "To original" on a
 *    card sale goes back to the card, never out of the cash drawer; on a sale
 *    paid more than one way the person refunding has to say which.
 */

/** What a person may ask for. */
export const REFUND_REQUEST_METHODS = ["original", "cash", "card", "store_credit"] as const;
export type RefundRequestMethod = (typeof REFUND_REQUEST_METHODS)[number];

/**
 * What is stored on the refund row: how the paid-out part left.
 *  - original: back to the cash the sale was paid in (out of the drawer)
 *  - cash: out of the drawer
 *  - card: back to the card (not the drawer)
 *  - store_credit: a gift card for the customer
 *  - credit: nothing paid out; the whole refund came off the customer's tab
 */
export const REFUND_STORED_METHODS = ["original", "cash", "card", "store_credit", "credit"] as const;
export type RefundStoredMethod = (typeof REFUND_STORED_METHODS)[number];

/** Methods whose paid-out part leaves the cash drawer. */
export function refundLeavesDrawer(method: string): boolean {
  return method === "cash" || method === "original";
}

/** The cash a refund takes out of the drawer: what it paid out in cash, not what came off a tab. */
export function refundCashOut(r: { refundMethod: string; total: number; creditAmount?: number | null }): number {
  if (!refundLeavesDrawer(r.refundMethod)) return 0;
  return round(Math.max(0, r.total - Math.max(0, r.creditAmount ?? 0)));
}

const round = (n: number) => Math.round(n * 100) / 100;

export type RefundLineInput = { orderLineId: string; qty: number; unitPrice: number };

/**
 * The amount each refunded line gives back.
 *
 * `lineValue` is the sale's line total (every line, unit × qty); `settled` is
 * what the sale was settled at. `remainingAfter` is true when this refund
 * takes the last unrefunded unit of the whole sale, so it gives back exactly
 * what is left of the settled total.
 */
export function refundLineAmounts(args: {
  lines: RefundLineInput[];
  lineValue: number;
  settled: number;
  priorRefunded: number;
  refundsEverything: boolean;
}): { amounts: number[]; total: number } {
  const { lines, lineValue, settled, priorRefunded, refundsEverything } = args;
  const ratio = lineValue > 0 ? settled / lineValue : 0;
  const amounts = lines.map((l) => round(l.unitPrice * l.qty * ratio));
  let total = round(amounts.reduce((s, a) => s + a, 0));
  const left = round(Math.max(0, settled - priorRefunded));
  if ((refundsEverything || total > left) && amounts.length > 0) {
    // Put the rounding on the last line so the lines still add up.
    const diff = round(left - total);
    amounts[amounts.length - 1] = round(amounts[amounts.length - 1] + diff);
    total = left;
  }
  return { amounts, total };
}

export type RefundTenderInput = {
  requested: RefundRequestMethod;
  refundTotal: number;
  /** The sale's paid payment legs (not awaiting). */
  legs: Array<{ method: string; amount: number }>;
  /** The order's single payment method, for sales with no legs. */
  paymentMethod: string | null | undefined;
  /** What is still owed on the sale's tab; 0 when it has none. */
  tabOutstanding: number;
  /** How the tab's repayments came in, when it has any. */
  tabPaymentMethods: string[];
};

export type RefundTender =
  | { ok: true; method: RefundStoredMethod; creditAmount: number; paidOut: number }
  | { ok: false; message: string };

function tenderKind(method: string): "cash" | "card" | "gift" | "tab" | "other" {
  const m = method.toLowerCase();
  if (m === "cash") return "cash";
  if (m === "card" || m === "card_link") return "card";
  if (m === "gift_card") return "gift";
  if (m === "tick" || m === "credit") return "tab";
  return "other";
}

export function resolveRefundTender(input: RefundTenderInput): RefundTender {
  const total = round(input.refundTotal);
  const creditAmount = round(Math.min(total, Math.max(0, input.tabOutstanding)));
  const paidOut = round(total - creditAmount);
  if (paidOut <= 0) return { ok: true, method: "credit", creditAmount, paidOut: 0 };

  if (input.requested !== "original") {
    return { ok: true, method: input.requested, creditAmount, paidOut };
  }

  // Where did the money that is being handed back come in? The till legs
  // that took money, and, for a tab, how it was repaid.
  const kinds = new Set<string>();
  const legs = input.legs.length > 0 ? input.legs : [{ method: String(input.paymentMethod ?? ""), amount: total }];
  for (const l of legs) {
    const k = tenderKind(l.method);
    if (k !== "tab") kinds.add(k);
  }
  for (const m of input.tabPaymentMethods) kinds.add(tenderKind(m) === "card" ? "card" : tenderKind(m) === "cash" ? "cash" : "other");

  if (kinds.size === 1 && kinds.has("cash")) return { ok: true, method: "original", creditAmount, paidOut };
  if (kinds.size === 1 && kinds.has("card")) return { ok: true, method: "card", creditAmount, paidOut };
  return {
    ok: false,
    message:
      kinds.has("gift")
        ? "This sale was paid with a gift card, so choose how the money goes back: cash, card or store credit."
        : "This sale was paid more than one way, so choose how the money goes back: cash, card or store credit.",
  };
}
