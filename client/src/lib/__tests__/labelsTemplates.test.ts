/**
 * Label templates (Settings → Labels): each switch removes exactly its part
 * of the label and nothing else, the defaults print what labels printed before
 * the settings existed, and a stored value of any shape reads back complete.
 */
import { describe, expect, it } from "vitest";
import {
  B1_GEOMETRY,
  buildDeliveryNoteLabel,
  buildOrderInfoLabel,
  buildOrderLabel,
  buildPackagingLabel,
  buildProductLabel,
  itemBounds,
  type LabelSpec,
  type Measure,
  type TextItem,
} from "@/lib/labels/labelLayout";
import {
  DEFAULT_LABEL_SETTINGS,
  labelSettingsInputSchema,
  mergeLabelSettings,
  normalizeLabelSettings,
  orderLabelKindsToPrint,
} from "@shared/labelSettings";

const measure: Measure = (text, size, bold) => [...text].length * size * (bold ? 0.62 : 0.56);
const texts = (spec: LabelSpec) => spec.items.filter((i): i is TextItem => i.kind === "text").map((i) => i.text);
const kinds = (spec: LabelSpec) => spec.items.map((i) => i.kind);
function expectInside(spec: LabelSpec) {
  for (const item of spec.items) {
    const b = itemBounds(item, measure);
    expect(b.x + b.w).toBeLessThanOrEqual(spec.geometry.width + 0.001);
    expect(b.y + b.h).toBeLessThanOrEqual(spec.geometry.height);
  }
}

const order = {
  orderId: "0a1b2c3d-0000-4000-8000-000000000000",
  shortCode: "0a1b2c3d",
  customerName: "Priya Shah",
  fulfilmentMethod: "delivery" as const,
  dueText: "14:30",
  itemCount: 3,
};
const url = "https://shop.example/operations?order=0a1b2c3d";

describe("order label switches", () => {
  it("prints the same as before with the defaults", () => {
    const withDefaults = buildOrderLabel(order, url, measure, B1_GEOMETRY, DEFAULT_LABEL_SETTINGS.order);
    const withoutArg = buildOrderLabel(order, url, measure, B1_GEOMETRY);
    expect(withDefaults).toEqual(withoutArg);
    expect(texts(withDefaults)).toEqual(["#0a1b2c3d", "Priya Shah", "DELIVERY", "Due 14:30", "3 items"]);
    expect(kinds(withDefaults)).toContain("qr");
  });

  it("leaves off exactly what is switched off, and still fits", () => {
    const spec = buildOrderLabel(order, url, measure, B1_GEOMETRY, {
      customerName: false,
      qr: false,
      fulfilment: false,
      due: true,
      itemCount: false,
    });
    expect(texts(spec)).toEqual(["#0a1b2c3d", "Due 14:30"]);
    expect(kinds(spec)).not.toContain("qr");
    expect(kinds(spec)).not.toContain("rect");
    expectInside(spec);
  });
});

describe("other label switches", () => {
  it("type & payment", () => {
    const input = { shortCode: "0a1b2c3d", customerName: "Priya Shah", fulfilmentMethod: "collection" as const, paymentMethodText: "Card" };
    expect(texts(buildOrderInfoLabel(input, measure))).toEqual(["#0a1b2c3d", "Priya Shah", "COLLECTION", "Pay: Card"]);
    expect(texts(buildOrderInfoLabel(input, measure, B1_GEOMETRY, { customerName: false, fulfilment: true, payment: false }))).toEqual([
      "#0a1b2c3d",
      "COLLECTION",
    ]);
  });

  it("packaging without the order number is just the name", () => {
    expect(texts(buildPackagingLabel({ shortCode: "0a1b2c3d", customerName: "Priya Shah" }, measure))).toEqual(["Priya Shah", "#0a1b2c3d"]);
    expect(texts(buildPackagingLabel({ shortCode: "0a1b2c3d", customerName: "Priya Shah" }, measure, B1_GEOMETRY, { orderCode: false }))).toEqual([
      "Priya Shah",
    ]);
  });

  it("delivery note can leave off the phone, address, payment and pay QR", () => {
    const input = {
      shortCode: "0a1b2c3d",
      customerName: "Priya Shah",
      phone: "07700 900123",
      address: "12 High Street",
      postcode: "AB1 2CD",
      paymentMethodText: "Card",
      payLinkUrl: "https://pay.example.invalid/x",
    };
    const full = buildDeliveryNoteLabel(input, measure);
    expect(texts(full)).toEqual(expect.arrayContaining(["07700 900123", "Pay: Card", "Scan to pay"]));
    const bare = buildDeliveryNoteLabel(input, measure, B1_GEOMETRY, { phone: false, address: false, payment: false, payQr: false });
    expect(texts(bare)).toEqual(["#0a1b2c3d", "Priya Shah"]);
    expect(kinds(bare)).not.toContain("qr");
  });

  it("product label can drop the price or the barcode", () => {
    const input = { name: "Sample product 500g", salePrice: 4.99, barcode: "5012345678900" };
    expect(texts(buildProductLabel(input, measure))).toEqual(expect.arrayContaining(["£4.99"]));
    expect(kinds(buildProductLabel(input, measure))).toContain("bars");
    const noPrice = buildProductLabel(input, measure, B1_GEOMETRY, { price: false, barcode: true });
    expect(texts(noPrice)).not.toContain("£4.99");
    const noBarcode = buildProductLabel(input, measure, B1_GEOMETRY, { price: true, barcode: false });
    expect(kinds(noBarcode)).not.toContain("bars");
    expect(texts(noBarcode).some((t) => t.includes("5012345678900"))).toBe(false);
    expectInside(noPrice);
    expectInside(noBarcode);
  });
});

describe("label settings values", () => {
  it("fills anything missing or malformed from the defaults", () => {
    expect(normalizeLabelSettings(null)).toEqual(DEFAULT_LABEL_SETTINGS);
    expect(normalizeLabelSettings("junk")).toEqual(DEFAULT_LABEL_SETTINGS);
    const partial = normalizeLabelSettings({ order: { qr: false, bogus: true }, autoPrintAfterPayment: "yes" });
    expect(partial.order).toEqual({ ...DEFAULT_LABEL_SETTINGS.order, qr: false });
    expect(partial.autoPrintAfterPayment).toBe(false);
    expect(partial).not.toHaveProperty("order.bogus");
  });

  it("merges a partial change into what is stored", () => {
    const stored = { printSet: { packaging: false }, order: { qr: false } };
    const merged = mergeLabelSettings(stored, { order: { due: false }, autoPrintAfterPayment: true });
    expect(merged.order).toMatchObject({ qr: false, due: false, customerName: true });
    expect(merged.printSet.packaging).toBe(false);
    expect(merged.autoPrintAfterPayment).toBe(true);
  });

  it("refuses unknown keys and non-booleans", () => {
    expect(labelSettingsInputSchema.safeParse({ order: { phone: true } }).success).toBe(false);
    expect(labelSettingsInputSchema.safeParse({ colour: "red" }).success).toBe(false);
    expect(labelSettingsInputSchema.safeParse({ printSet: { order: "yes" } }).success).toBe(false);
    expect(labelSettingsInputSchema.safeParse({ printSet: { order: false } }).success).toBe(true);
  });

  it("chooses which labels 'Print labels' prints", () => {
    expect(orderLabelKindsToPrint(DEFAULT_LABEL_SETTINGS, "collection")).toEqual(["order", "picking", "orderInfo", "packaging"]);
    expect(orderLabelKindsToPrint(DEFAULT_LABEL_SETTINGS, "delivery")).toContain("deliveryNote");
    const none = normalizeLabelSettings({
      printSet: { order: false, picking: false, orderInfo: false, packaging: false, deliveryNote: false },
    });
    expect(orderLabelKindsToPrint(none, "delivery")).toEqual(["order"]);
  });
});
