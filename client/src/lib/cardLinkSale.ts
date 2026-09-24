/**
 * Card (link) on a sale the till is sending (v1.2 Stripe links): how much of
 * it the customer pays by link, or null when none of it is.
 */
import { CARD_LINK_METHOD } from "@shared/payments/cardLink";

export type CardLinkSale = {
  orderId: string;
  amount: number;
  /** Phone and WhatsApp orders get a day to pay; a customer at the counter, half an hour. */
  longLived: boolean;
  hasCustomer: boolean;
};

export function cardLinkAmountOf(sale: {
  paymentMethod?: unknown;
  payments?: Array<{ method: string; amount: number }> | unknown;
  expectedTotal?: unknown;
} | null | undefined): number | null {
  if (!sale) return null;
  if (Array.isArray(sale.payments)) {
    const leg = (sale.payments as Array<{ method: string; amount: number }>).find((l) => l.method === CARD_LINK_METHOD);
    return leg ? Number(leg.amount) : null;
  }
  if (sale.paymentMethod === CARD_LINK_METHOD) {
    const total = Number(sale.expectedTotal);
    return Number.isFinite(total) ? total : 0;
  }
  return null;
}
