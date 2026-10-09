/**
 * Building and printing one order's labels, shared by the order's details
 * sheet, the one-tap "Print labels" on a board card, and the till after
 * payment — so all three print exactly the same labels, laid out by the
 * shop's own label settings (Settings → Labels).
 */
import { apiFetch, APP_BASE } from "@/lib/appPaths";
import { formatPaymentLabel } from "@/lib/paymentLabel";
import type { LabelSettings, OrderLabelKind } from "@shared/labelSettings";
import {
  buildDeliveryNoteLabel,
  buildOrderInfoLabel,
  buildOrderLabel,
  buildPackagingLabel,
  buildPickingLabels,
  orderLabelUrl,
  type LabelGeometry,
  type LabelSpec,
} from "./labelLayout";
import { connectPrinter, currentGeometry, getPrinterState, printBitmap } from "./niimbot";
import { canvasMeasure, renderLabel } from "./renderLabel";

export interface OrderLabelsOrder {
  id: string;
  shortCode: string;
  customerName: string | null;
  fulfilmentMethod: "collection" | "delivery";
  itemCount: number;
  /** Already formatted, e.g. formatPaymentLabel(order.paymentMethod). */
  paymentMethodText: string;
  items: Array<{ stockNumber: string | null; quantity: number }>;
  deliveryAddress?: string | null;
  deliveryPostcode?: string | null;
}

/**
 * The phone is fetched fresh from the same on-demand, never-cached reveal the
 * board's "Show number to call" uses (OpsCustomerCall) — never read from the
 * board or query cache, and never held here past this one print.
 */
async function revealPhone(orderId: string): Promise<string | null> {
  try {
    const res = await apiFetch(`/api/orders/${orderId}/customer-phone`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    return typeof body?.phone === "string" ? body.phone : null;
  } catch {
    return null;
  }
}

/** Only an OPEN Stripe Card (link) checkout is worth a "Scan to pay" QR. */
async function openCardLinkUrl(orderId: string): Promise<string | null> {
  try {
    const res = await apiFetch(`/api/card-links/${orderId}`, { credentials: "include" });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    return body?.link?.status === "open" && typeof body.link.url === "string" ? body.link.url : null;
  } catch {
    return null;
  }
}

/** The labels one type prints for an order (a long picking list runs to several). */
export async function buildOrderLabelSpecs(
  kind: OrderLabelKind,
  order: OrderLabelsOrder,
  dueText: string | null,
  settings: LabelSettings,
  geometry: LabelGeometry = currentGeometry(),
  /** The editor's preview passes these instead of asking the server. */
  extras?: { phone?: string | null; payLinkUrl?: string | null },
): Promise<LabelSpec[]> {
  switch (kind) {
    case "order":
      return [
        buildOrderLabel(
          {
            orderId: order.id,
            shortCode: order.shortCode,
            customerName: order.customerName,
            fulfilmentMethod: order.fulfilmentMethod,
            dueText,
            itemCount: order.itemCount,
          },
          orderLabelUrl(window.location.origin, APP_BASE, order.id),
          canvasMeasure,
          geometry,
          settings.order,
        ),
      ];
    case "picking":
      return buildPickingLabels(
        { shortCode: order.shortCode, lines: order.items.map((i) => ({ stockNumber: i.stockNumber ?? "-", quantity: i.quantity })) },
        canvasMeasure,
        geometry,
      );
    case "orderInfo":
      return [
        buildOrderInfoLabel(
          {
            shortCode: order.shortCode,
            customerName: order.customerName,
            fulfilmentMethod: order.fulfilmentMethod,
            paymentMethodText: order.paymentMethodText,
          },
          canvasMeasure,
          geometry,
          settings.orderInfo,
        ),
      ];
    case "packaging":
      return [
        buildPackagingLabel({ shortCode: order.shortCode, customerName: order.customerName }, canvasMeasure, geometry, settings.packaging),
      ];
    case "deliveryNote": {
      // Only what the settings will actually print is fetched.
      const [phone, payLinkUrl] = extras
        ? [extras.phone ?? null, extras.payLinkUrl ?? null]
        : await Promise.all([
            settings.deliveryNote.phone ? revealPhone(order.id) : Promise.resolve(null),
            settings.deliveryNote.payQr ? openCardLinkUrl(order.id) : Promise.resolve(null),
          ]);
      return [
        buildDeliveryNoteLabel(
          {
            shortCode: order.shortCode,
            customerName: order.customerName,
            phone,
            address: order.deliveryAddress ?? null,
            postcode: order.deliveryPostcode ?? null,
            paymentMethodText: order.paymentMethodText,
            payLinkUrl,
          },
          canvasMeasure,
          geometry,
          settings.deliveryNote,
        ),
      ];
    }
  }
}

/**
 * Prints the given label types for one order, in order. The printer takes one
 * bitmap at a time, so a set is a sequence of prints, not one job. Connects
 * first (a no-op when already connected).
 */
export async function printOrderLabels(
  order: OrderLabelsOrder,
  dueText: string | null,
  kinds: OrderLabelKind[],
  settings: LabelSettings,
): Promise<number> {
  await connectPrinter();
  let printed = 0;
  for (const kind of kinds) {
    for (const spec of await buildOrderLabelSpecs(kind, order, dueText, settings)) {
      const { bitmap } = renderLabel(spec);
      await printBitmap(bitmap, 1);
      printed += 1;
    }
  }
  return printed;
}

/**
 * Everything the labels need about one order, from its detail (the same
 * `GET /api/orders/:id` the details sheet reads: names only, the delivery
 * address only where this viewer may see it).
 */
export async function loadOrderForLabels(orderId: string): Promise<OrderLabelsOrder> {
  const res = await apiFetch(`/api/orders/${orderId}`, { credentials: "include", cache: "no-store" });
  if (!res.ok) throw new Error("Could not load this order to print its labels.");
  const d = await res.json();
  const items: Array<{ stockNumber?: string | null; quantity?: number }> = Array.isArray(d.items) ? d.items : [];
  const name = typeof d.customerName === "string" && d.customerName.trim() && d.customerName !== "Walk-in" ? d.customerName : null;
  return {
    id: d.id,
    shortCode: typeof d.reference === "string" && d.reference ? d.reference : String(d.id).slice(0, 8),
    customerName: name,
    fulfilmentMethod: d.fulfilmentMethod === "delivery" ? "delivery" : "collection",
    itemCount: items.length,
    paymentMethodText: formatPaymentLabel(String(d.paymentMethod ?? "")),
    items: items.map((i) => ({ stockNumber: i.stockNumber ?? null, quantity: Number(i.quantity ?? 0) })),
    deliveryAddress: d.deliveryAddress ?? null,
    deliveryPostcode: d.deliveryPostcode ?? null,
  };
}

/** What went wrong, in the printer module's plain English when it has it (e.g. "No printer chosen"). */
export function labelPrintErrorMessage(e: unknown): string {
  return getPrinterState().error ?? (e instanceof Error ? e.message : "Could not print the labels.");
}
