/**
 * The shop's label template settings (Settings → Labels): which label types
 * "Print labels" prints for an order, which details go on each label, and
 * whether a till prints them by itself once an order is paid.
 *
 * Stored on the organisation (`organizations.label_settings`, migration 232)
 * so every till prints the same labels. A stored value is always read through
 * `normalizeLabelSettings`: a missing or older shape falls back field by field
 * to the defaults, which are exactly what the labels printed before this page
 * existed — so an org that never opens it sees no change.
 *
 * What is NOT here, on purpose: the customer's phone and address on anything
 * but the Delivery note (it leaves with the driver; the other labels stay on
 * shelves and bags), and a cost price anywhere.
 */
import { z } from "zod";

export const ORDER_LABEL_KINDS = ["order", "picking", "orderInfo", "packaging", "deliveryNote"] as const;
export type OrderLabelKind = (typeof ORDER_LABEL_KINDS)[number];

export const ORDER_LABEL_TITLES: Record<OrderLabelKind, string> = {
  order: "Order label",
  picking: "Picking list",
  orderInfo: "Type & payment",
  packaging: "Packaging",
  deliveryNote: "Delivery note",
};

export interface OrderLabelFields {
  customerName: boolean;
  qr: boolean;
  fulfilment: boolean;
  due: boolean;
  itemCount: boolean;
}
export interface OrderInfoLabelFields {
  customerName: boolean;
  fulfilment: boolean;
  payment: boolean;
}
export interface PackagingLabelFields {
  orderCode: boolean;
}
export interface DeliveryNoteLabelFields {
  phone: boolean;
  address: boolean;
  payment: boolean;
  payQr: boolean;
}
export interface ProductLabelFields {
  price: boolean;
  barcode: boolean;
}

export interface LabelSettings {
  /** The label types "Print labels" prints for an order (a Delivery note only ever for a delivery). */
  printSet: Record<OrderLabelKind, boolean>;
  order: OrderLabelFields;
  orderInfo: OrderInfoLabelFields;
  packaging: PackagingLabelFields;
  deliveryNote: DeliveryNoteLabelFields;
  product: ProductLabelFields;
  /** Print the order's labels by themselves once the till takes payment (only on a till with a paired printer). */
  autoPrintAfterPayment: boolean;
}

export const DEFAULT_LABEL_SETTINGS: LabelSettings = {
  printSet: { order: true, picking: true, orderInfo: true, packaging: true, deliveryNote: true },
  order: { customerName: true, qr: true, fulfilment: true, due: true, itemCount: true },
  orderInfo: { customerName: true, fulfilment: true, payment: true },
  packaging: { orderCode: true },
  deliveryNote: { phone: true, address: true, payment: true, payQr: true },
  product: { price: true, barcode: true },
  autoPrintAfterPayment: false,
};

/** What a label shows for each switch — the editor's wording, kept next to the switches it describes. */
export const LABEL_FIELD_TEXT = {
  order: {
    customerName: "Customer name (Walk-in when none)",
    qr: "QR code that opens the order on the board",
    fulfilment: "COLLECTION / DELIVERY block",
    due: "Due time",
    itemCount: "Number of items",
  },
  orderInfo: {
    customerName: "Customer name",
    fulfilment: "COLLECTION / DELIVERY block",
    payment: "How it was paid",
  },
  packaging: { orderCode: "Order number in small print under the name" },
  deliveryNote: {
    phone: "Customer's phone number",
    address: "Delivery address and postcode",
    payment: "How it was paid",
    payQr: "“Scan to pay” QR when a card link is open",
  },
  product: { price: "Sale price", barcode: "Barcode" },
} as const;

const bool = z.boolean();
const partialRecord = <T extends Record<string, true>>(shape: T) =>
  z.object(Object.fromEntries(Object.keys(shape).map((k) => [k, bool])) as { [K in keyof T]: typeof bool }).partial().strict();

/** The body PUT /api/labels/settings accepts: any subset, unknown keys refused. */
export const labelSettingsInputSchema = z
  .object({
    printSet: partialRecord({ order: true, picking: true, orderInfo: true, packaging: true, deliveryNote: true }),
    order: partialRecord({ customerName: true, qr: true, fulfilment: true, due: true, itemCount: true }),
    orderInfo: partialRecord({ customerName: true, fulfilment: true, payment: true }),
    packaging: partialRecord({ orderCode: true }),
    deliveryNote: partialRecord({ phone: true, address: true, payment: true, payQr: true }),
    product: partialRecord({ price: true, barcode: true }),
    autoPrintAfterPayment: bool,
  })
  .partial()
  .strict();

export type LabelSettingsInput = z.infer<typeof labelSettingsInputSchema>;

function pickBools<T extends object>(defaults: T, raw: unknown): T {
  const out = { ...defaults } as Record<string, boolean>;
  if (raw && typeof raw === "object") {
    for (const key of Object.keys(defaults)) {
      const v = (raw as Record<string, unknown>)[key];
      if (typeof v === "boolean") out[key] = v;
    }
  }
  return out as T;
}

/** Any stored value (null, partial, an older shape, junk) as a complete settings object. */
export function normalizeLabelSettings(raw: unknown): LabelSettings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_LABEL_SETTINGS;
  return {
    printSet: pickBools(d.printSet, r.printSet),
    order: pickBools(d.order, r.order),
    orderInfo: pickBools(d.orderInfo, r.orderInfo),
    packaging: pickBools(d.packaging, r.packaging),
    deliveryNote: pickBools(d.deliveryNote, r.deliveryNote),
    product: pickBools(d.product, r.product),
    autoPrintAfterPayment: typeof r.autoPrintAfterPayment === "boolean" ? r.autoPrintAfterPayment : d.autoPrintAfterPayment,
  };
}

/** Stored settings with a change applied (a partial body merges into what is there). */
export function mergeLabelSettings(current: unknown, patch: LabelSettingsInput): LabelSettings {
  const base = normalizeLabelSettings(current);
  return normalizeLabelSettings({
    printSet: { ...base.printSet, ...patch.printSet },
    order: { ...base.order, ...patch.order },
    orderInfo: { ...base.orderInfo, ...patch.orderInfo },
    packaging: { ...base.packaging, ...patch.packaging },
    deliveryNote: { ...base.deliveryNote, ...patch.deliveryNote },
    product: { ...base.product, ...patch.product },
    autoPrintAfterPayment: patch.autoPrintAfterPayment ?? base.autoPrintAfterPayment,
  });
}

/**
 * The label types "Print labels" prints for one order, in print order. A
 * Delivery note only for a delivery; never an empty set — if every type is
 * switched off, the Order label still prints, so the button always does
 * something.
 */
export function orderLabelKindsToPrint(settings: LabelSettings, fulfilmentMethod: "collection" | "delivery"): OrderLabelKind[] {
  const kinds = ORDER_LABEL_KINDS.filter(
    (k) => settings.printSet[k] && (k !== "deliveryNote" || fulfilmentMethod === "delivery"),
  );
  return kinds.length ? kinds : ["order"];
}
