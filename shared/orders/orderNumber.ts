import { nextInvoiceSequence } from "../invoices/invoiceRules";

/** The first order number a shop issues. Already-issued orders are not renumbered. */
export const ORDER_NUMBER_START = 440_400_001;

/** The first invoice number a shop issues. Already-issued invoices are not renumbered. */
export const INVOICE_NUMBER_START = 440_000_001;

/** Shown where an order has no numbered invoice yet. */
export const INVOICE_NOT_ISSUED = "Not issued";

/**
 * The next number to issue.
 *
 * One past the last number actually used, and never below `floor` or the
 * shop's own start. Raising the start jumps forward. Lowering it does not
 * reuse a number.
 */
export function nextIssuedNumber(
  lastIssued: number | null | undefined,
  startNumber: number | null | undefined,
  floor: number,
): number {
  const chosen = Number(startNumber);
  const start = Number.isFinite(chosen) && chosen > 0 ? Math.trunc(chosen) : floor;
  return nextInvoiceSequence(lastIssued, Math.max(start, floor));
}

/**
 * What to show for an order. A number issued by the shop, or the start of
 * the reference it already had.
 */
export function displayOrderNumber(id: string, orderNumber: number | null | undefined): string {
  if (typeof orderNumber === "number" && Number.isInteger(orderNumber) && orderNumber > 0) return String(orderNumber);
  return String(id ?? "").slice(0, 8);
}
