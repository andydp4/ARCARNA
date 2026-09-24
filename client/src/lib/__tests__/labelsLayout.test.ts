/**
 * Niimbot labels: what goes on a 50 × 30 mm label, and that it fits.
 * A fixed-pitch measure stands in for canvas text metrics.
 */
import { describe, expect, it } from "vitest";
import { encode as encodeQr } from "uqr";
import {
  B1_GEOMETRY,
  ELLIPSIS,
  buildOrderLabel,
  buildProductLabel,
  fitText,
  formatLabelPrice,
  itemBounds,
  labelGeometry,
  orderLabelUrl,
  wrapText,
  type LabelSpec,
  type Measure,
  type TextItem,
} from "@/lib/labels/labelLayout";
import { orderDueText, orderLabelInput, productLabelInput } from "@/lib/labels/labelRequests";

const measure: Measure = (text, size, bold) => [...text].length * size * (bold ? 0.62 : 0.56);
const texts = (spec: LabelSpec) => spec.items.filter((i): i is TextItem => i.kind === "text").map((i) => i.text);

function expectInside(spec: LabelSpec) {
  for (const item of spec.items) {
    const b = itemBounds(item, measure);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.x + b.w).toBeLessThanOrEqual(spec.geometry.width + 0.001);
    expect(b.y + b.h).toBeLessThanOrEqual(spec.geometry.height);
  }
}

function overlaps(a: { x: number; y: number; w: number; h: number }, b: typeof a) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe("geometry", () => {
  it("B1: 203 dpi, 384-dot head → 384 × 240 dots", () => {
    expect(B1_GEOMETRY).toMatchObject({ width: 384, height: 240 });
    expect(B1_GEOMETRY.dotsPerMm).toBeCloseTo(8, 1);
  });
  it("a 300 dpi head wider than 50 mm is capped at the label width, in whole bytes", () => {
    expect(labelGeometry(300, 1000)).toMatchObject({ width: 584, height: 354 });
  });
});

describe("fitText / wrapText", () => {
  it("keeps the largest size that fits", () => {
    expect(fitText("#AB12CD34", 300, { max: 44, min: 24, bold: true }, measure)).toEqual({
      text: "#AB12CD34",
      size: 44,
      truncated: false,
    });
  });
  it("shrinks before it truncates", () => {
    const r = fitText("Alexandra Montgomery", 230, { max: 30, min: 18, bold: true }, measure);
    expect(r.truncated).toBe(false);
    expect(r.size).toBeLessThan(30);
    expect(measure(r.text, r.size, true)).toBeLessThanOrEqual(230);
  });
  it("truncates with an ellipsis at the minimum size, and still fits", () => {
    const r = fitText("Bartholomew Fitzgerald-Worthington the Third", 200, { max: 30, min: 18, bold: true }, measure);
    expect(r.truncated).toBe(true);
    expect(r.size).toBe(18);
    expect(r.text.endsWith(ELLIPSIS)).toBe(true);
    expect(measure(r.text, 18, true)).toBeLessThanOrEqual(200);
    expect(r.text.startsWith("Bartholomew")).toBe(true);
  });
  it("wraps onto two lines and cuts the rest", () => {
    const r = wrapText("Extra large chocolate fudge celebration cake with candles, sparklers and a personalised message", 368, 2, { max: 28, min: 18, bold: true }, measure);
    expect(r.lines.length).toBe(2);
    expect(r.truncated).toBe(true);
    expect(r.lines[1].endsWith(ELLIPSIS)).toBe(true);
    for (const l of r.lines) expect(measure(l, r.size, true)).toBeLessThanOrEqual(368);
  });
  it("leaves short names on one line at full size", () => {
    expect(wrapText("Cola 330ml", 368, 2, { max: 28, min: 18, bold: true }, measure)).toEqual({
      lines: ["Cola 330ml"],
      size: 28,
      truncated: false,
    });
  });
});

describe("order label", () => {
  const url = orderLabelUrl("https://till.example.com", "/arcarna", "3f2a9c1e-0000-4000-8000-000000000001");
  const base = {
    orderId: "3f2a9c1e-0000-4000-8000-000000000001",
    shortCode: "3F2A9C1E",
    customerName: "Priya Shah",
    fulfilmentMethod: "delivery" as const,
    dueText: "14:30",
    itemCount: 3,
  };

  it("QR opens the order on the Ops board and carries nothing but its id", () => {
    expect(url).toBe("https://till.example.com/arcarna/operations?order=3f2a9c1e-0000-4000-8000-000000000001");
    expect(orderLabelUrl("https://x.test/", "/", "a b")).toBe("https://x.test/operations?order=a%20b");
    expect(orderLabelUrl("https://x.test", "/arcarna/", "id")).toBe("https://x.test/arcarna/operations?order=id");
  });

  it("carries short code, name, method, due time, item count and a scannable QR", () => {
    const spec = buildOrderLabel(base, url, measure);
    expect(texts(spec)).toEqual(["#3F2A9C1E", "Priya Shah", "DELIVERY", "Due 14:30", "3 items"]);
    const qr = spec.items.find((i) => i.kind === "qr");
    expect(qr && qr.kind === "qr" && qr.payload).toBe(url);
    if (qr?.kind !== "qr") throw new Error("no qr");
    expect(qr.modules).toEqual(encodeQr(url, { ecc: "M", border: 0 }).data);
    expect(qr.scale).toBeGreaterThanOrEqual(3);
    expectInside(spec);
  });

  it("keeps the text column clear of the QR", () => {
    const spec = buildOrderLabel({ ...base, customerName: "A really very long customer name indeed" }, url, measure);
    const qr = spec.items.find((i) => i.kind === "qr")!;
    const qrBox = itemBounds(qr, measure);
    for (const item of spec.items) {
      if (item.kind === "qr") continue;
      expect(overlaps(itemBounds(item, measure), qrBox)).toBe(false);
    }
    expect(texts(spec)[1].endsWith(ELLIPSIS)).toBe(true);
  });

  it("leaves the QR a 4-module quiet zone on its left", () => {
    // A long code and name fill the text column right up to its edge.
    const spec = buildOrderLabel({ ...base, shortCode: "WWWWWWWWWWWW", customerName: "W".repeat(60) }, url, measure);
    const qr = spec.items.find((i) => i.kind === "qr");
    if (qr?.kind !== "qr") throw new Error("no qr");
    for (const item of spec.items) {
      if (item.kind === "qr") continue;
      const b = itemBounds(item, measure);
      expect(qr.x - (b.x + b.w)).toBeGreaterThanOrEqual(4 * qr.scale);
    }
  });

  it("walk-in, collection, no due time, one item", () => {
    const spec = buildOrderLabel({ ...base, customerName: null, fulfilmentMethod: "collection", dueText: null, itemCount: 1 }, url, measure);
    expect(texts(spec)).toEqual(["#3F2A9C1E", "Walk-in", "COLLECTION", "No due time", "1 item"]);
    expectInside(spec);
  });

  it("never puts the phone on the label, even though the board row has it", () => {
    const boardRow = {
      id: base.orderId,
      shortCode: base.shortCode,
      customerName: "Priya Shah",
      customerPhone: "07700 900123",
      fulfilmentMethod: "delivery" as const,
      itemCount: 3,
    };
    const input = orderLabelInput(boardRow, "14:30");
    expect(Object.keys(input).sort()).toEqual(["customerName", "dueText", "fulfilmentMethod", "itemCount", "orderId", "shortCode"]);
    const spec = buildOrderLabel(input, url, measure);
    expect(JSON.stringify(spec)).not.toContain("07700");
  });

  it("scales the layout for a 300 dpi head", () => {
    const g = labelGeometry(300, 591);
    expectInside(buildOrderLabel(base, url, measure, g));
  });
});

describe("order due text", () => {
  const tz = "Europe/London";
  const now = new Date("2026-09-23T10:00:00Z");
  it("time only when due today; day and time otherwise; null without one", () => {
    expect(orderDueText(new Date("2026-09-23T13:30:00Z"), now, tz)).toBe("14:30");
    expect(orderDueText(new Date("2026-09-25T13:30:00Z"), now, tz)).toMatch(/^FRI 25 SEPT? 14:30$/);
    expect(orderDueText(null, now, tz)).toBeNull();
  });
});

describe("product label", () => {
  it("name, sale price and EAN-13 bars; never the cost price", () => {
    const input = productLabelInput({
      name: "Cola 330ml",
      price: "1.20",
      defaultSalePrice: "1.10",
      barcode: "5012345678900",
      // A manager's product row also has this; it must not reach the label.
      ...({ costPrice: "0.43" } as object),
    });
    expect(input).toEqual({ name: "Cola 330ml", salePrice: 1.2, barcode: "5012345678900" });
    const spec = buildProductLabel(input, measure);
    expect(texts(spec)).toEqual(["5012345678900", "Cola 330ml", "£1.20"]);
    expect(JSON.stringify(spec)).not.toContain("0.43");
    const bars = spec.items.find((i) => i.kind === "bars");
    if (bars?.kind !== "bars") throw new Error("no bars");
    expect(bars.modules.length).toBe(95);
    expect(bars.moduleDots).toBe(3);
    expectInside(spec);
  });

  it("falls back to the default sale price", () => {
    expect(productLabelInput({ name: "Tea", defaultSalePrice: "2.5", barcode: " " })).toEqual({ name: "Tea", salePrice: 2.5, barcode: null });
    expect(formatLabelPrice(2.5)).toBe("£2.50");
  });

  it("uses Code 128 for a non-EAN code and keeps two dots a module", () => {
    const spec = buildProductLabel({ name: "Bag", salePrice: 0.1, barcode: "WM-0042" }, measure);
    const bars = spec.items.find((i) => i.kind === "bars");
    if (bars?.kind !== "bars") throw new Error("no bars");
    expect(bars.moduleDots).toBeGreaterThanOrEqual(2);
    expectInside(spec);
  });

  it("prints a code too long to scan as text only", () => {
    const spec = buildProductLabel({ name: "Pallet", salePrice: 99, barcode: "SUPPLIER-REF-ABCDEFGHIJKLMNOP-2026" }, measure);
    expect(spec.items.some((i) => i.kind === "bars")).toBe(false);
    expect(texts(spec)[0].startsWith("SUPPLIER-REF")).toBe(true);
    expectInside(spec);
  });

  it("no barcode: just name and a bigger price", () => {
    const spec = buildProductLabel({ name: "Extra large chocolate fudge celebration cake with candles", salePrice: 24, barcode: null }, measure);
    expect(spec.items.every((i) => i.kind === "text")).toBe(true);
    const price = spec.items.find((i): i is TextItem => i.kind === "text" && i.text === "£24.00")!;
    expect(price.size).toBeGreaterThan(44);
    expectInside(spec);
  });
});
