/**
 * Rule-based order-intent parser (no AI).
 *
 * Scans an inbound message for likely order intent, matches product
 * names/aliases/SKUs, and extracts quantities. Produces a suggestion only —
 * a human always confirms before a real order is created (Principle 14).
 */
import type { WhatsappParsedItem } from "@shared/schema";

export interface IntentProduct {
  productId: string; // business SKU (products.product_id)
  name: string;
  aliases?: string[] | null;
}

export interface ParsedIntent {
  isOrderLike: boolean;
  items: WhatsappParsedItem[];
  confidence: number;
  triggers: string[];
}

const TRIGGER_PHRASES = [
  "can i get",
  "can i have",
  "could i get",
  "i need",
  "i want",
  "i'll take",
  "ill take",
  "send me",
  "send over",
  "same again",
  "how much for",
  "order",
  "collect",
  "collection",
  "delivery",
  "deliver",
];

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  dozen: 12,
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Find a quantity associated with a product mention at [start, end] in text. */
function quantityNear(text: string, start: number, matchLen: number): number {
  const before = text.slice(Math.max(0, start - 24), start).toLowerCase();
  const after = text.slice(start + matchLen, start + matchLen + 12).toLowerCase();

  // "x3" or "3x" close to the product.
  const xRight = after.match(/^\s*x\s*(\d{1,3})/);
  if (xRight) return clampQty(Number(xRight[1]));
  const xLeft = before.match(/(\d{1,3})\s*x\s*$/);
  if (xLeft) return clampQty(Number(xLeft[1]));

  // Digit immediately before, e.g. "2 boxes of coke", "3 coke".
  const digitBefore = before.match(/(\d{1,3})\s*(?:boxes|box|packs|pack|cases|case|x)?\s*(?:of\s+)?$/);
  if (digitBefore) return clampQty(Number(digitBefore[1]));

  // Number word before, e.g. "two coke", "a coffee".
  const wordBefore = before.match(/([a-z]+)\s*(?:boxes|box|packs|pack|cases|case)?\s*(?:of\s+)?$/);
  if (wordBefore && NUMBER_WORDS[wordBefore[1]] !== undefined) {
    return clampQty(NUMBER_WORDS[wordBefore[1]]);
  }

  return 1;
}

function clampQty(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 999);
}

function findTriggers(lower: string): string[] {
  return TRIGGER_PHRASES.filter((p) => lower.includes(p));
}

export function parseOrderIntent(rawText: string, products: IntentProduct[]): ParsedIntent {
  const text = (rawText ?? "").trim();
  const lower = text.toLowerCase();
  const triggers = findTriggers(lower);

  const items: WhatsappParsedItem[] = [];
  const seen = new Set<string>();

  // Build candidate terms (name + aliases + SKU) per product, longest first so
  // "large coke" wins over "coke".
  type Term = { term: string; product: IntentProduct };
  const terms: Term[] = [];
  for (const p of products) {
    const candidates = [p.name, p.productId, ...(p.aliases ?? [])]
      .map((t) => (t ?? "").trim())
      .filter((t) => t.length >= 2);
    for (const term of candidates) terms.push({ term, product: p });
  }
  terms.sort((a, b) => b.term.length - a.term.length);

  const consumedRanges: Array<[number, number]> = [];
  const overlaps = (s: number, e: number) =>
    consumedRanges.some(([cs, ce]) => s < ce && e > cs);

  for (const { term, product } of terms) {
    // Allow a simple trailing plural (e.g. alias "coke" matches "cokes").
    const re = new RegExp(`\\b${escapeRegExp(term.toLowerCase())}s?\\b`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(lower))) {
      const start = m.index;
      const matchLen = m[0].length;
      const end = start + matchLen;
      if (overlaps(start, end)) continue;
      if (seen.has(product.productId)) continue;
      consumedRanges.push([start, end]);
      seen.add(product.productId);
      items.push({
        productId: product.productId,
        sku: product.productId,
        name: product.name,
        quantity: quantityNear(text, start, matchLen),
        matched: true,
      });
    }
  }

  const isOrderLike = items.length > 0 || (triggers.length > 0 && /\d/.test(text));

  let confidence = 0;
  if (items.length > 0) confidence = Math.min(0.6 + 0.1 * (items.length - 1), 0.95);
  if (triggers.length > 0) confidence = Math.min(confidence + 0.2, 0.97);
  if (items.length === 0) confidence = Math.min(confidence, 0.3);

  return { isOrderLike, items, confidence: Number(confidence.toFixed(3)), triggers };
}
