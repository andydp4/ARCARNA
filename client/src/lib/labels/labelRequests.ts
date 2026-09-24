/**
 * Build label inputs from the rows the pages already hold, picking fields by
 * name so nothing else on the row — a cost price on a manager's product
 * list, a phone number on a board card — can reach a label.
 */
import { formatDayChip, formatTimeOfDay } from "@/lib/opsClock";
import type { OrderLabelInput, ProductLabelInput } from "./labelLayout";

export interface ProductRowLike {
  name?: string | null;
  /** The list's effective sale price, when it sends one. */
  price?: string | number | null;
  defaultSalePrice?: string | number | null;
  barcode?: string | null;
}

export function productLabelInput(product: ProductRowLike): ProductLabelInput {
  // Same precedence the Products list shows as the price.
  const raw = product.price || product.defaultSalePrice || 0;
  const salePrice = Number.parseFloat(String(raw));
  return {
    name: (product.name ?? "").trim() || "Product",
    salePrice: Number.isFinite(salePrice) ? salePrice : 0,
    barcode: product.barcode?.trim() || null,
  };
}

export interface BoardOrderLike {
  id: string;
  shortCode: string;
  customerName: string | null;
  fulfilmentMethod: "collection" | "delivery";
  itemCount: number;
}

export function orderLabelInput(order: BoardOrderLike, dueText: string | null): OrderLabelInput {
  return {
    orderId: order.id,
    shortCode: order.shortCode,
    customerName: order.customerName?.trim() || null,
    fulfilmentMethod: order.fulfilmentMethod === "delivery" ? "delivery" : "collection",
    dueText,
    itemCount: Math.max(0, Math.floor(order.itemCount ?? 0)),
  };
}

/**
 * "14:30", or "FRI 12 SEP 14:30" when it is not due today — the same due
 * time the board's card counts down to (promise, else the org's SLA).
 */
export function orderDueText(dueAt: Date | null, now: Date, timeZone: string): string | null {
  if (!dueAt || Number.isNaN(dueAt.getTime())) return null;
  const time = formatTimeOfDay(dueAt, timeZone);
  const sameDay = formatDayChip(dueAt, timeZone) === formatDayChip(now, timeZone);
  return sameDay ? time : `${formatDayChip(dueAt, timeZone)} ${time}`;
}
