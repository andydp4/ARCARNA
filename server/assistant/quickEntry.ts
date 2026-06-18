/**
 * QuickEntryEngine — stateful, multi-turn order entry.
 *
 * Pure logic (no DB access): given the in-progress draft and the latest
 * utterance, decides what's still missing, what to ask next, and when the
 * order is ready to save. Designed to be driven turn-by-turn from any input
 * channel (typed command bar, voice/mic, Siri Shortcuts, future WhatsApp
 * voice notes) — the caller persists `draft` between turns and hands it back.
 *
 * Rule-based, no AI (mirrors server/whatsapp/intent.ts). A human always
 * confirms ("Save it?" -> "Yes.") before a real order is created.
 */
import { parseOrderIntent, type IntentProduct } from "../whatsapp/intent";

export interface QuickEntryItemDraft {
  productId: string; // business SKU, matches IntentProduct.productId
  name: string;
  quantity: number;
  unitPrice?: number;
}

export interface QuickEntryExpenseDraft {
  label: string;
  amount: number;
}

export type QuickEntryStatus = "collecting" | "confirming";

export interface QuickEntryDraft {
  status: QuickEntryStatus;
  customerName?: string;
  items: QuickEntryItemDraft[];
  fulfillment?: { label: string; isoDate: string };
  expensesAsked: boolean;
  expenses: QuickEntryExpenseDraft[];
  paymentMethod: "cash" | "card" | "transfer" | "tick";
  rawText: string;
}

export type QuickEntryAction = "ask" | "save" | "cancel";

export interface QuickEntryTurnResult {
  action: QuickEntryAction;
  draft: QuickEntryDraft | null;
  message: string;
  voiceResponse: string;
  missingFields: string[];
}

const YES_RE = /^\s*(yes|yeah|yep|yup|correct|confirm|confirmed|save it|do it|go ahead|please)\b/i;
const NO_RE = /^\s*(no|nope|nah|cancel|stop|don'?t|discard|scrap that)\b/i;
const NONE_RE = /^\s*(none|no expenses|nothing|n\/a|nope|no)\s*\.?\s*$/i;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const PAYMENT_KEYWORDS: Record<string, QuickEntryDraft["paymentMethod"]> = {
  cash: "cash",
  card: "card",
  transfer: "transfer",
  "bank transfer": "transfer",
  tick: "tick",
  "on tick": "tick",
  credit: "tick",
};

function detectPaymentMethod(text: string): QuickEntryDraft["paymentMethod"] | undefined {
  const lower = text.toLowerCase();
  for (const [kw, method] of Object.entries(PAYMENT_KEYWORDS)) {
    if (lower.includes(kw)) return method;
  }
  return undefined;
}

/** Pulls a relative date phrase ("today", "tomorrow", a weekday name) out of free text. */
function parseFulfillment(text: string, now: Date): { label: string; isoDate: string } | undefined {
  const lower = text.toLowerCase();
  if (/\btoday\b/.test(lower)) {
    return { label: "today", isoDate: now.toISOString().slice(0, 10) };
  }
  if (/\btomorrow\b/.test(lower)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return { label: "tomorrow", isoDate: d.toISOString().slice(0, 10) };
  }
  for (let i = 0; i < WEEKDAYS.length; i++) {
    const day = WEEKDAYS[i];
    if (new RegExp(`\\b${day}\\b`).test(lower)) {
      const d = new Date(now);
      const delta = (i - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + delta);
      return { label: day, isoDate: d.toISOString().slice(0, 10) };
    }
  }
  return undefined;
}

/** "<Name> wants/needs/would like ..." -> the leading name. */
function parseCustomerName(text: string): string | undefined {
  const m = text.match(
    /^\s*([A-Z][a-zA-Z'’-]{1,40}(?:\s[A-Z][a-zA-Z'’-]{1,40})?)\s+(?:wants?|would like|needs?|requires?|ordered|orders?)\b/,
  );
  return m?.[1]?.trim();
}

/** First £-prefixed or bare number in the text, e.g. "£20 each" / "20 each" -> 20. */
function parseMoney(text: string): number | undefined {
  const m = text.match(/£?\s*(\d+(?:\.\d{1,2})?)/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

/** "£30 train" / "30 for train" -> { amount: 30, label: "train" }. */
function parseExpense(text: string): QuickEntryExpenseDraft | undefined {
  const amount = parseMoney(text);
  if (amount === undefined) return undefined;
  const label = text
    .replace(/£\s*\d+(?:\.\d{1,2})?/, "")
    .replace(/\d+(?:\.\d{1,2})?/, "")
    .replace(/\b(for|expense|expenses|cost|each|spent|on)\b/gi, "")
    .replace(/[.,]/g, "")
    .trim();
  return { amount, label: label || "expense" };
}

function formatGBP(n: number): string {
  return `£${n.toFixed(2).replace(/\.00$/, "")}`;
}

function itemsSummary(items: QuickEntryItemDraft[]): string {
  return items.map((i) => `${i.quantity} ${i.name}`).join(", ");
}

function buildConfirmationMessage(draft: QuickEntryDraft): string {
  let itemsPart = itemsSummary(draft.items);
  if (draft.items[0]?.unitPrice !== undefined) {
    itemsPart += ` at ${formatGBP(draft.items[0].unitPrice)} each`;
  }
  const parts = [draft.customerName ?? "this customer", itemsPart];
  if (draft.expenses.length > 0) {
    parts.push(draft.expenses.map((e) => `${e.label} expense ${formatGBP(e.amount)}`).join(", "));
  }
  return `Ready to save: ${parts.join(", ")}. Save it?`;
}

function ask(draft: QuickEntryDraft, message: string, missingFields: string[]): QuickEntryTurnResult {
  return { action: "ask", draft, message, voiceResponse: message, missingFields };
}

/** Starts a new draft from a fresh utterance. Returns undefined if no order intent was found. */
function startDraft(text: string, products: IntentProduct[], now: Date): QuickEntryDraft | undefined {
  const intent = parseOrderIntent(text, products);
  if (intent.items.length === 0) return undefined;
  return {
    status: "collecting",
    customerName: parseCustomerName(text),
    items: intent.items.map((i) => ({ productId: i.productId ?? i.name, name: i.name, quantity: i.quantity })),
    fulfillment: parseFulfillment(text, now),
    expensesAsked: false,
    expenses: [],
    paymentMethod: detectPaymentMethod(text) ?? "tick",
    rawText: text,
  };
}

/**
 * Advances a quick-entry conversation by one turn.
 *
 * @param draft Current in-progress order, or null/undefined to start fresh.
 * @param text Latest utterance (typed or transcribed).
 * @param products Org's products, used for name/alias/SKU matching.
 * @param now Injection point for tests; defaults to current time.
 */
export function processQuickEntryTurn(
  draft: QuickEntryDraft | null | undefined,
  text: string,
  products: IntentProduct[],
  now: Date = new Date(),
): QuickEntryTurnResult {
  const trimmed = (text ?? "").trim();

  if (!draft) {
    const started = startDraft(trimmed, products, now);
    if (!started) {
      const message = "I didn't catch an order in that. Try something like 'Bunny wants 50 Product 1 tomorrow.'";
      return { action: "ask", draft: null, message, voiceResponse: message, missingFields: ["items"] };
    }
    return continueDraft(started);
  }

  if (draft.status === "confirming") {
    if (YES_RE.test(trimmed)) {
      return { action: "save", draft, message: "Saving order.", voiceResponse: "Done. Order saved.", missingFields: [] };
    }
    if (NO_RE.test(trimmed)) {
      const message = "No problem, discarded. What would you like to do instead?";
      return { action: "cancel", draft: null, message, voiceResponse: message, missingFields: [] };
    }
    return ask(draft, "Please say yes to save or no to cancel.", []);
  }

  // Collecting: fill in whichever slot is next.
  if (!draft.customerName) {
    const name = trimmed.replace(/[.!]+$/, "").trim();
    if (!name) return ask(draft, "Who is this order for?", ["customerName"]);
    return continueDraft({ ...draft, customerName: name });
  }

  if (draft.items.some((i) => i.unitPrice === undefined)) {
    const price = parseMoney(trimmed);
    if (price === undefined) return ask(draft, "What price per item?", ["unitPrice"]);
    return continueDraft({
      ...draft,
      items: draft.items.map((i) => ({ ...i, unitPrice: price })),
    });
  }

  if (draft.expenses.length === 0 && !NONE_RE.test(trimmed)) {
    const expense = parseExpense(trimmed);
    if (!expense) return ask(draft, "Any expenses? Say an amount and what it was for, or 'none'.", ["expenses"]);
    return continueDraft({ ...draft, expenses: [expense] });
  }

  return continueDraft({ ...draft, status: "confirming" });
}

/** Decides the next prompt for a draft that just changed. */
function continueDraft(draft: QuickEntryDraft): QuickEntryTurnResult {
  if (!draft.customerName) {
    return ask(draft, "Who is this order for?", ["customerName"]);
  }
  if (draft.items.some((i) => i.unitPrice === undefined)) {
    return ask(draft, "What price per item?", ["unitPrice"]);
  }
  if (!draft.expensesAsked) {
    return ask({ ...draft, expensesAsked: true }, "Any expenses?", ["expenses"]);
  }
  const confirming: QuickEntryDraft = { ...draft, status: "confirming" };
  const message = buildConfirmationMessage(confirming);
  return { action: "ask", draft: confirming, message, voiceResponse: message, missingFields: [] };
}
