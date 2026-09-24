/**
 * An emailed receipt's money (pure, so it is tested without a mail server).
 *
 *  - VAT is what the sale was charged (orders.vat_amount, migration 082). An
 *    order from before it was recorded keeps the old 20%-inclusive estimate;
 *    reading 20% off a 0% sale made every receipt claim VAT nobody charged.
 *  - The delivery fee (v1.2.1) is its own line, never folded into an item.
 */
import { storedDeliveryFee } from "@shared/orders/deliveryFee";

export type ReceiptLineInput = {
  productName: string | null;
  quantity: number;
  unitPrice: string | null;
  totalPrice: string | null;
};

export type ReceiptMoneyLine = { name: string; qty: number; unitPrice: number; lineTotal: number };

export function receiptMoney(
  order: { total: string | null; vatAmount?: string | null; deliveryFee?: string | null },
  items: ReceiptLineInput[],
  feeName: string,
): { total: number; subtotal: number; tax: number; lines: ReceiptMoneyLine[] } {
  const total = parseFloat(order.total || "0") || 0;
  const storedVat = order.vatAmount == null ? null : parseFloat(String(order.vatAmount));
  const tax =
    storedVat != null && Number.isFinite(storedVat) ? storedVat : Math.round((total - total / 1.2) * 100) / 100;
  const subtotal = Math.round((total - tax) * 100) / 100;
  const lines: ReceiptMoneyLine[] = items.map((item) => ({
    name: item.productName || "Item",
    qty: item.quantity,
    unitPrice: parseFloat(item.unitPrice || "0") || 0,
    lineTotal: parseFloat(item.totalPrice || "0") || 0,
  }));
  const fee = storedDeliveryFee(order);
  if (fee > 0) lines.push({ name: feeName, qty: 1, unitPrice: fee, lineTotal: fee });
  return { total, subtotal, tax, lines };
}
