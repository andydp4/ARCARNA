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
 * "completed" the moment they do. Without a credit record, the sale was paid
 * at the till once it completed; a sale not yet completed (a website order
 * awaiting payment) is owed.
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
  } else {
    outstanding = orderStatus === "completed" ? 0 : round(Math.max(0, input.orderTotal));
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
  return round(Math.max(0, input.orderTotal));
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

/**
 * An invoice's subtotal and VAT. A sale priced since Phase 1B carries its own
 * VAT amount and rate; an older one is split at the org's rate. At 0% there
 * is no VAT at all, and the invoice shows no VAT line.
 */
export function invoiceAmounts(input: {
  total: number;
  vatAmount?: number | null;
  vatRate?: number | null;
  orgVatRate: number;
}): { subtotal: number; tax: number; vatRate: number } {
  const total = round(input.total);
  if (input.vatAmount != null && Number.isFinite(input.vatAmount)) {
    const tax = round(input.vatAmount);
    const rate = input.vatRate != null && Number.isFinite(input.vatRate) ? input.vatRate : input.orgVatRate;
    return { subtotal: round(total - tax), tax, vatRate: rate };
  }
  const rate = Number.isFinite(input.orgVatRate) ? input.orgVatRate : 0;
  if (rate <= 0) return { subtotal: total, tax: 0, vatRate: 0 };
  const tax = round((total * rate) / (100 + rate));
  return { subtotal: round(total - tax), tax, vatRate: rate };
}

/** A VAT line is shown only when VAT was charged. */
export function showsVatLine(tax: number, vatRate: number | null | undefined): boolean {
  return round(tax) !== 0 || (vatRate != null && vatRate > 0);
}
