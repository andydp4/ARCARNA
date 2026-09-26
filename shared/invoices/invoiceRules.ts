import { shiftIsoDate } from "../time/tradingDay";

/**
 * Invoices (v1.2 Phase 1C, CMP-07).
 *
 * One status rule for every screen, PDF and count that shows an invoice, so
 * the Invoices page, the PDF and the Credit List can never disagree about
 * whether somebody still owes money.
 */

export const INVOICE_STATUSES = ["paid", "part-paid", "owed", "overdue", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  paid: "Paid",
  "part-paid": "Part-paid",
  owed: "Owed",
  overdue: "Overdue",
  void: "Void",
};

export type InvoiceCreditState = {
  /** order_credit.status: outstanding | partial | settled | written_off | voided */
  status: string;
  amountGiven: number;
  amountOutstanding: number;
};

export type InvoiceStatusInput = {
  orderStatus: string | null | undefined;
  orderTotal: number;
  /** The order's credit (tick) record, if any of it went on a tab. */
  credit: InvoiceCreditState | null;
  /**
   * Money taken at the till for this order, from its payment legs (not tab,
   * not personal use). Null when the order has no legs (a website order).
   */
  paidAtTill?: number | null;
  /** YYYY-MM-DD; the last day to pay. */
  dueDate: string | null | undefined;
  /** The organisation's trading day, YYYY-MM-DD. */
  today: string;
};

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Paid, part-paid, owed, overdue or void.
 *
 * Money owed is read from the credit record, never from order status: an
 * order's status says whether the goods have gone, and a tab sale is
 * "completed" the moment they do. Without a credit record, what the payment
 * legs say was taken at the till is paid — every till sale is "pending" until
 * it is completed on the board, but the customer has already paid. With no
 * legs either, a completed sale was paid and one not yet completed (a website
 * order awaiting payment) is owed.
 *
 * Overdue wins over part-paid: a part-paid invoice past its date is late.
 * A written-off debt shows as void — it will not be collected, and showing
 * it as owed would keep chasing it (the Credit List already drops it).
 */
export function invoiceStatus(input: InvoiceStatusInput): InvoiceStatus {
  const orderStatus = String(input.orderStatus ?? "").toLowerCase();
  if (orderStatus === "cancelled" || orderStatus === "voided") return "void";

  let outstanding: number;
  let partPaid = false;
  if (input.credit) {
    const creditStatus = input.credit.status;
    if (creditStatus === "voided" || creditStatus === "written_off") return "void";
    outstanding = round(Math.max(0, input.credit.amountOutstanding));
    partPaid = outstanding > 0 && outstanding < round(input.credit.amountGiven);
  } else if (orderStatus === "completed") {
    outstanding = 0;
  } else if (input.paidAtTill != null && Number.isFinite(input.paidAtTill)) {
    outstanding = round(Math.max(0, input.orderTotal - input.paidAtTill));
    partPaid = outstanding > 0 && input.paidAtTill > 0;
  } else {
    outstanding = round(Math.max(0, input.orderTotal));
  }

  if (outstanding <= 0) return "paid";
  if (input.dueDate && input.today > input.dueDate) return "overdue";
  return partPaid ? "part-paid" : "owed";
}

/** What is still to pay on an invoice, under the same rule as its status. */
export function invoiceAmountDue(input: InvoiceStatusInput): number {
  const status = invoiceStatus(input);
  if (status === "paid" || status === "void") return 0;
  if (input.credit) return round(Math.max(0, input.credit.amountOutstanding));
  if (input.paidAtTill != null && Number.isFinite(input.paidAtTill)) {
    return round(Math.max(0, input.orderTotal - input.paidAtTill));
  }
  return round(Math.max(0, input.orderTotal));
}

/** Tender that is not money taken: a tab is owed, personal use is not a sale. */
export function isMoneyTakenMethod(method: string): boolean {
  const m = String(method ?? "").toLowerCase();
  return m !== "tick" && m !== "personal_use";
}

/** Days allowed when the terms name none, as before numbering existed. */
export const DEFAULT_PAYMENT_DAYS = 30;
const MAX_PAYMENT_DAYS = 365;

/**
 * How many days the org's payment terms allow. The terms are free text
 * ("Net 30", "14 days", "Due on receipt"), so this reads the obvious forms and
 * falls back to 30 days — what every invoice was given before.
 */
export function paymentDaysFromTerms(terms: string | null | undefined): number {
  const text = String(terms ?? "").trim().toLowerCase();
  if (!text) return DEFAULT_PAYMENT_DAYS;
  if (/(on|upon) receipt|immediate|cash on delivery/.test(text)) return 0;
  const match = text.match(/(\d{1,3})/);
  if (!match) return DEFAULT_PAYMENT_DAYS;
  return Math.min(MAX_PAYMENT_DAYS, Number(match[1]));
}

/** The due date an invoice issued on `issuedOn` gets under `terms`. */
export function dueDateFromTerms(issuedOn: string, terms: string | null | undefined): string {
  return shiftIsoDate(issuedOn, paymentDaysFromTerms(terms));
}

/** INV-1000. The prefix is the org's own; blank falls back to INV. */
export function formatInvoiceNumber(prefix: string | null | undefined, sequence: number): string {
  const clean = String(prefix ?? "").trim() || "INV";
  return `${clean}-${sequence}`;
}

/**
 * The next number: one past the last issued, and never below the org's
 * chosen start. Raising the start number jumps to it; lowering it does not
 * reuse numbers already issued.
 */
export function nextInvoiceSequence(lastIssued: number | null | undefined, startNumber: number | null | undefined): number {
  const start = Number.isFinite(Number(startNumber)) && Number(startNumber) > 0 ? Math.trunc(Number(startNumber)) : 1000;
  const last = lastIssued == null ? null : Math.trunc(Number(lastIssued));
  if (last == null || !Number.isFinite(last)) return start;
  return Math.max(last + 1, start);
}

export type InvoiceAmounts = {
  /** The lines, before any discount and before VAT. */
  subtotal: number;
  /** Tier and promotion discounts, taken off before VAT. */
  discount: number;
  tax: number;
  vatRate: number;
  /** Points, taken off what the customer pays after VAT (owner decision Q2). */
  pointsDiscount: number;
  /** The delivery fee (v1.2.1): its own line, after discounts, before VAT. 0 when none. */
  deliveryFee: number;
};

/**
 * The subtotal an invoice ROW stores: goods and delivery fee together, so the
 * stored row adds up on its own (subtotal − discount + VAT − points = total)
 * with no fee column. The page and PDF show the two apart.
 */
export function storedInvoiceSubtotal(amounts: Pick<InvoiceAmounts, "subtotal" | "deliveryFee">): number {
  return round(amounts.subtotal + (amounts.deliveryFee ?? 0));
}

/**
 * An invoice's breakdown, so its figures add up on the page:
 *   subtotal − discount + VAT − points = total.
 * A sale priced since Phase 1B carries every figure; an older one is split at
 * the org's rate with no discounts shown, as before. At 0% there is no VAT at
 * all, and the invoice shows no VAT line.
 */
export function invoiceAmounts(input: {
  total: number;
  vatAmount?: number | null;
  vatRate?: number | null;
  orgVatRate: number;
  subtotal?: number | null;
  tierDiscount?: number | null;
  promoDiscount?: number | null;
  pointsDiscount?: number | null;
  deliveryFee?: number | null;
}): InvoiceAmounts {
  const total = round(input.total);
  const fee = round(Math.max(0, input.deliveryFee ?? 0));
  const has = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
  if (has(input.vatAmount)) {
    const tax = round(input.vatAmount);
    const rate = has(input.vatRate) ? input.vatRate : input.orgVatRate;
    if (has(input.subtotal)) {
      const subtotal = round(input.subtotal);
      const discount = round((input.tierDiscount ?? 0) + (input.promoDiscount ?? 0));
      const pointsDiscount = round(input.pointsDiscount ?? 0);
      // Only a breakdown that reaches the total is shown; anything else (an
      // order edited by hand in the database) falls back to total − VAT.
      if (Math.abs(round(subtotal - discount + fee + tax - pointsDiscount) - total) <= 0.005) {
        return { subtotal, discount, tax, vatRate: rate, pointsDiscount, deliveryFee: fee };
      }
    }
    return { subtotal: round(total - tax), discount: 0, tax, vatRate: rate, pointsDiscount: 0, deliveryFee: 0 };
  }
  const rate = Number.isFinite(input.orgVatRate) ? input.orgVatRate : 0;
  if (rate <= 0) return { subtotal: total, discount: 0, tax: 0, vatRate: 0, pointsDiscount: 0, deliveryFee: 0 };
  const tax = round((total * rate) / (100 + rate));
  return { subtotal: round(total - tax), discount: 0, tax, vatRate: rate, pointsDiscount: 0, deliveryFee: 0 };
}

/** A VAT line is shown only when VAT was charged. */
export function showsVatLine(tax: number, vatRate: number | null | undefined): boolean {
  return round(tax) !== 0 || (vatRate != null && vatRate > 0);
}
