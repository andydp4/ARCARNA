/**
 * What goes where on a 50 × 30 mm label, in printer dots.
 *
 * Pure: text width comes from an injected `measure` (canvas measureText in
 * the browser, a fixed-pitch stand-in in tests), so the fitting and
 * truncation rules are tested without a canvas. `renderLabel.ts` turns the
 * returned spec into pixels.
 *
 * Privacy: the order label is built from `OrderLabelInput`, which has no
 * phone, email or address field on purpose — a label leaves the shop on a
 * bag. Customer NAME only (Niimbot brief, Build → Label templates).
 */
import { encode as encodeQr } from "uqr";
import type { BarcodeSymbol } from "./barcode";
import { barcodeForProduct } from "./barcode";

export const LABEL_WIDTH_MM = 50;
export const LABEL_HEIGHT_MM = 30;

export interface LabelGeometry {
  /** Dots across the print head (the page's columns). */
  width: number;
  /** Dots along the feed (the page's rows). */
  height: number;
  dotsPerMm: number;
}

/**
 * Page size for a printer. The B1 is 203 dpi (8 dots/mm) with a 384-dot
 * head, so a 50 mm label prints 48 mm (384 dots) across and 30 mm (240 rows)
 * along the feed; the head is narrower than the label, not the other way.
 */
export function labelGeometry(dpi = 203, printheadPixels = 384): LabelGeometry {
  const dotsPerMm = dpi / 25.4;
  // Whole bytes across: the bitmap rows are sent 8 dots to a byte.
  const width = Math.min(printheadPixels, Math.floor(LABEL_WIDTH_MM * dotsPerMm));
  return { width: width - (width % 8), height: Math.round(LABEL_HEIGHT_MM * dotsPerMm), dotsPerMm };
}

export const B1_GEOMETRY: LabelGeometry = labelGeometry(203, 384);

export type Measure = (text: string, fontPx: number, bold: boolean) => number;

export interface TextItem {
  kind: "text";
  x: number;
  /** Top of the line box. */
  y: number;
  text: string;
  size: number;
  bold: boolean;
  /** Width the text was fitted into (already fits; renderers need not clip). */
  maxWidth: number;
  align: "left" | "center";
  /** White text — drawn on top of a filled rect. */
  inverse?: boolean;
}
export interface RectItem {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface QrItem {
  kind: "qr";
  x: number;
  y: number;
  /** Dots per module. */
  scale: number;
  modules: boolean[][];
  payload: string;
}
export interface BarsItem {
  kind: "bars";
  x: number;
  y: number;
  h: number;
  /** Dots per module. */
  moduleDots: number;
  modules: boolean[];
}
export type LabelItem = TextItem | RectItem | QrItem | BarsItem;

export interface LabelSpec {
  geometry: LabelGeometry;
  items: LabelItem[];
}

export const ELLIPSIS = "…";

export interface FittedText {
  text: string;
  size: number;
  truncated: boolean;
}

/**
 * Largest size between max and min (2-dot steps) at which `text` fits
 * `maxWidth`; at min size, cut it and end with an ellipsis.
 */
export function fitText(
  text: string,
  maxWidth: number,
  opts: { max: number; min: number; bold: boolean },
  measure: Measure,
): FittedText {
  const clean = text.replace(/\s+/g, " ").trim();
  for (let size = opts.max; size >= opts.min; size -= 2) {
    if (measure(clean, size, opts.bold) <= maxWidth) return { text: clean, size, truncated: false };
  }
  return { text: truncateToWidth(clean, maxWidth, opts.min, opts.bold, measure), size: opts.min, truncated: true };
}

export function truncateToWidth(text: string, maxWidth: number, size: number, bold: boolean, measure: Measure): string {
  if (measure(text, size, bold) <= maxWidth) return text;
  const chars = [...text];
  // Binary search the longest prefix that still fits with the ellipsis.
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(chars.slice(0, mid).join("").trimEnd() + ELLIPSIS, size, bold) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? ELLIPSIS : chars.slice(0, lo).join("").trimEnd() + ELLIPSIS;
}

/**
 * Word-wrap into at most `maxLines` lines at the largest size that fits;
 * whatever still overflows at min size is cut with an ellipsis on the last line.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  maxLines: number,
  opts: { max: number; min: number; bold: boolean },
  measure: Measure,
): { lines: string[]; size: number; truncated: boolean } {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const layout = (size: number) => {
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (measure(candidate, size, opts.bold) <= maxWidth || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    return lines;
  };
  for (let size = opts.max; size >= opts.min; size -= 2) {
    const lines = layout(size);
    if (lines.length <= maxLines && lines.every((l) => measure(l, size, opts.bold) <= maxWidth)) {
      return { lines, size, truncated: false };
    }
  }
  const lines = layout(opts.min);
  const kept = lines.slice(0, maxLines);
  const overflow = lines.length > maxLines;
  const last = overflow ? `${kept[kept.length - 1]} ${lines.slice(maxLines).join(" ")}` : kept[kept.length - 1];
  kept[kept.length - 1] = truncateToWidth(last, maxWidth, opts.min, opts.bold, measure);
  const truncated = overflow || kept.some((l, i) => l !== lines[i]);
  // Any earlier line that is a single over-long word gets cut too.
  for (let i = 0; i < kept.length - 1; i++) kept[i] = truncateToWidth(kept[i], maxWidth, opts.min, opts.bold, measure);
  return { lines: kept, size: opts.min, truncated };
}

const LINE = 1.15;

// ── Order label ──────────────────────────────────────────────────────────

export interface OrderLabelInput {
  orderId: string;
  shortCode: string;
  /** Name only — see the module note. Null for a walk-in. */
  customerName: string | null;
  fulfilmentMethod: "collection" | "delivery";
  /** Already formatted in the shop's time zone, e.g. "14:30" or "Fri 12 Sep 14:30". Null when there is none. */
  dueText: string | null;
  itemCount: number;
}

/**
 * The QR payload: an absolute link to this order on the Ops board. The board
 * opens `?order=<id>` straight into the order's details (operations.tsx), and
 * the normal sign-in and role rules apply to whoever scans it — the QR
 * carries no customer data, only the order id.
 */
export function orderLabelUrl(origin: string, appBase: string, orderId: string): string {
  const base = appBase === "/" ? "" : appBase.replace(/\/+$/, "");
  return `${origin.replace(/\/+$/, "")}${base}/operations?order=${encodeURIComponent(orderId)}`;
}

export function itemCountText(n: number): string {
  return `${n} item${n === 1 ? "" : "s"}`;
}

export function buildOrderLabel(
  input: OrderLabelInput,
  qrPayload: string,
  measure: Measure,
  geometry: LabelGeometry = B1_GEOMETRY,
): LabelSpec {
  const { width: W, height: H, dotsPerMm } = geometry;
  const s = dotsPerMm / 8; // layout is designed at 8 dots/mm
  const d = (n: number) => Math.round(n * s);
  const margin = d(8);
  const items: LabelItem[] = [];

  // QR on the right, as large as ~19 mm allows at a whole number of dots per
  // module; below 3 dots a module (0.375 mm) phone cameras struggle, so the
  // code is left off rather than printed unscannable.
  const qr = encodeQr(qrPayload, { ecc: "M", border: 0 });
  const qrScale = Math.min(Math.floor(d(152) / qr.size), Math.floor((H - 2 * margin) / qr.size));
  let textRight = W - margin;
  if (qrScale >= 3) {
    const qrPx = qr.size * qrScale;
    const qrX = W - margin - qrPx;
    items.push({ kind: "qr", x: qrX, y: Math.round((H - qrPx) / 2), scale: qrScale, modules: qr.data, payload: qrPayload });
    // QR readers want a 4-module quiet zone; the code is encoded with no
    // border of its own, so keep text at least that far from it.
    textRight = qrX - Math.max(d(8), 4 * qrScale);
  }
  const colW = textRight - margin;
  let y = margin;

  const code = fitText(`#${input.shortCode}`, colW, { max: d(44), min: d(24), bold: true }, measure);
  items.push({ kind: "text", x: margin, y, text: code.text, size: code.size, bold: true, maxWidth: colW, align: "left" });
  y += Math.round(code.size * LINE);

  const name = fitText(input.customerName?.trim() || "Walk-in", colW, { max: d(30), min: d(18), bold: true }, measure);
  items.push({ kind: "text", x: margin, y, text: name.text, size: name.size, bold: true, maxWidth: colW, align: "left" });
  y += Math.round(name.size * LINE) + d(4);

  // Delivery/Collection as a solid block: readable at arm's length on a shelf.
  const methodText = input.fulfilmentMethod === "delivery" ? "DELIVERY" : "COLLECTION";
  const pad = d(4);
  const method = fitText(methodText, colW - 2 * pad, { max: d(24), min: d(16), bold: true }, measure);
  const boxW = Math.min(colW, Math.ceil(measure(method.text, method.size, true)) + 2 * pad);
  const boxH = Math.round(method.size * LINE) + pad;
  items.push({ kind: "rect", x: margin, y, w: boxW, h: boxH });
  items.push({ kind: "text", x: margin + pad, y: y + Math.round(pad / 2), text: method.text, size: method.size, bold: true, maxWidth: colW - 2 * pad, align: "left", inverse: true });
  y += boxH + d(6);

  const due = fitText(input.dueText ? `Due ${input.dueText}` : "No due time", colW, { max: d(26), min: d(16), bold: true }, measure);
  items.push({ kind: "text", x: margin, y, text: due.text, size: due.size, bold: true, maxWidth: colW, align: "left" });
  y += Math.round(due.size * LINE);

  const count = fitText(itemCountText(input.itemCount), colW, { max: d(22), min: d(16), bold: false }, measure);
  items.push({ kind: "text", x: margin, y, text: count.text, size: count.size, bold: false, maxWidth: colW, align: "left" });

  return { geometry, items };
}

// ── Product label ────────────────────────────────────────────────────────

export interface ProductLabelInput {
  name: string;
  /** The price the customer pays. Never the cost price. */
  salePrice: number;
  barcode: string | null;
  currencySymbol?: string;
}

export function formatLabelPrice(amount: number, symbol = "£"): string {
  return `${symbol}${(Number.isFinite(amount) ? amount : 0).toFixed(2)}`;
}

/** Dots per module for a symbol across `available` dots, keeping a 10-module quiet zone each side. */
export function barcodeModuleDots(symbol: BarcodeSymbol, available: number): number {
  return Math.floor(available / (symbol.modules.length + 20));
}

export function buildProductLabel(input: ProductLabelInput, measure: Measure, geometry: LabelGeometry = B1_GEOMETRY): LabelSpec {
  const { width: W, height: H, dotsPerMm } = geometry;
  const s = dotsPerMm / 8;
  const d = (n: number) => Math.round(n * s);
  const margin = d(8);
  const colW = W - 2 * margin;
  const items: LabelItem[] = [];

  const symbol = barcodeForProduct(input.barcode);
  // Two dots (0.25 mm) is the narrowest bar a till scanner reads reliably
  // off this head; a code too long for that is printed as text only.
  const moduleDots = symbol ? barcodeModuleDots(symbol, colW) : 0;
  const bars = symbol && moduleDots >= 2 ? symbol : null;
  const codeText = symbol?.text ?? (input.barcode?.trim() || null);

  // Bottom block first, so the name and price get whatever is left.
  let bottom = H - margin;
  if (codeText) {
    const digits = fitText(codeText, colW, { max: d(18), min: d(14), bold: false }, measure);
    const digitsY = bottom - Math.round(digits.size * LINE);
    items.push({ kind: "text", x: margin, y: digitsY, text: digits.text, size: digits.size, bold: false, maxWidth: colW, align: "center" });
    bottom = digitsY;
    if (bars) {
      const barsH = d(56);
      const barsW = bars.modules.length * moduleDots;
      const barsY = bottom - barsH;
      items.push({ kind: "bars", x: margin + Math.floor((colW - barsW) / 2), y: barsY, h: barsH, moduleDots, modules: bars.modules });
      bottom = barsY - d(4);
    }
  }

  let y = margin;
  const price = fitText(formatLabelPrice(input.salePrice, input.currencySymbol), colW, { max: codeText ? d(44) : d(64), min: d(24), bold: true }, measure);
  const room = bottom - y - Math.round(price.size * LINE);
  const nameMax = codeText ? d(28) : d(34);
  const maxLines = Math.max(1, Math.min(2, Math.floor(room / Math.round(d(20) * LINE))));
  const name = wrapText(input.name || "Product", colW, maxLines, { max: nameMax, min: d(18), bold: true }, measure);
  for (const line of name.lines) {
    items.push({ kind: "text", x: margin, y, text: line, size: name.size, bold: true, maxWidth: colW, align: "left" });
    y += Math.round(name.size * LINE);
  }
  items.push({ kind: "text", x: margin, y, text: price.text, size: price.size, bold: true, maxWidth: colW, align: "left" });

  return { geometry, items };
}

/** Bounding box of an item, for layout checks. */
export function itemBounds(item: LabelItem, measure: Measure): { x: number; y: number; w: number; h: number } {
  switch (item.kind) {
    case "text": {
      const w = measure(item.text, item.size, item.bold);
      const x = item.align === "center" ? item.x + (item.maxWidth - w) / 2 : item.x;
      return { x, y: item.y, w, h: Math.round(item.size * LINE) };
    }
    case "rect":
      return { x: item.x, y: item.y, w: item.w, h: item.h };
    case "qr": {
      const px = item.modules.length * item.scale;
      return { x: item.x, y: item.y, w: px, h: px };
    }
    case "bars":
      return { x: item.x, y: item.y, w: item.modules.length * item.moduleDots, h: item.h };
  }
}
