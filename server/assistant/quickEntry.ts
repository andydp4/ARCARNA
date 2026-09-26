/**
 * QuickEntryEngine — stateful, multi-turn order entry.
 *
 * Pure logic (no DB access): given the in-progress draft and the latest
 * utterance, decides what's still missing, what to ask next, and when the
 * draft is ready. Driven by Ask arcarna's draft_order tool (server/ask/
 * tools.ts), which calls it fresh each time rather than holding a draft
 * between turns — one request either resolves cleanly or comes back asking
 * for whatever was unclear.
 *
 * v1.2 Phase 1B (owner Q19): the assistant no longer SAVES orders. It
 * produces a draft that opens in the till, where the till prices it (no single
 * spoken price for every item), the cashier takes payment (no default to
 * tick) and adds any expenses. A name that matches several customers is asked
 * about rather than guessed. It will be rebuilt later on the "Ask arcarna"
 * engine; nothing new is built here.
 *
 * Rule-based, no AI (mirrors server/whatsapp/intent.ts).
 */
import { parseOrderIntent, type IntentProduct } from "../whatsapp/intent";

export interface QuickEntryItemDraft {
  productId: string; // business SKU, matches IntentProduct.productId
  name: string;
  quantity: number;
}

export interface QuickEntryCustomerCandidate {
  id: string;
  name: string;
}

export type QuickEntryStatus = "collecting" | "choosing-customer" | "confirming";

export interface QuickEntryDraft {
  status: QuickEntryStatus;
  customerName?: string;
  /** Set once the name has been looked up; null = nobody matched (picked in the till). */
  customerId?: string | null;
  customerResolved?: boolean;
  /** The customers a name could mean, while asking which. */
  customerCandidates?: QuickEntryCustomerCandidate[];
  items: QuickEntryItemDraft[];
  fulfillment?: { label: string; isoDate: string };
  rawText: string;
}

export type QuickEntryAction = "ask" | "draft" | "cancel";

/** What the till opens with. Prices, payment and expenses are set there. */
export interface TillDraft {
  customerId: string | null;
  customerName: string | null;
  items: Array<{ sku: string; name: string; quantity: number }>;
  note?: string;
}

export interface QuickEntryTurnResult {
  action: QuickEntryAction;
  draft: QuickEntryDraft | null;
  message: string;
  voiceResponse: string;
  missingFields: string[];
  /** Set when action === "draft". */
  tillDraft?: TillDraft;
}

const YES_RE = /^\s*(yes|yeah|yep|yup|correct|confirm|confirmed|open it|do it|go ahead|please)\b/i;
const NO_RE = /^\s*(no|nope|nah|cancel|stop|don'?t|discard|scrap that)\b/i;
const NOBODY_RE = /^\s*(none|nobody|none of them|neither|new customer|someone else)\b/i;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

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

function itemsSummary(items: QuickEntryItemDraft[]): string {
  return items.map((i) => `${i.quantity} ${i.name}`).join(", ");
}

function buildConfirmationMessage(draft: QuickEntryDraft): string {
  const who = draft.customerId ? draft.customerName : `${draft.customerName ?? "this customer"} (pick the customer in the till)`;
  const when = draft.fulfillment ? `, for ${draft.fulfillment.label}` : "";
  return `Ready to open in the till: ${who}, ${itemsSummary(draft.items)}${when}. Open it?`;
}

export function tillDraftFrom(draft: QuickEntryDraft): TillDraft {
  return {
    customerId: draft.customerId ?? null,
    customerName: draft.customerName ?? null,
    items: draft.items.map((i) => ({ sku: i.productId, name: i.name, quantity: i.quantity })),
    ...(draft.fulfillment ? { note: `For ${draft.fulfillment.label} (${draft.fulfillment.isoDate})` } : {}),
  };
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
      const message = "Opening it in the till. Check the prices and take payment there.";
      return {
        action: "draft",
        draft: null,
        message,
        voiceResponse: "Opening it in the till.",
        missingFields: [],
        tillDraft: tillDraftFrom(draft),
      };
    }
    if (NO_RE.test(trimmed)) {
      const message = "No problem, discarded. What would you like to do instead?";
      return { action: "cancel", draft: null, message, voiceResponse: message, missingFields: [] };
    }
    return ask(draft, "Please say yes to open it in the till, or no to cancel.", []);
  }

  if (draft.status === "choosing-customer") {
    return chooseCustomer(draft, trimmed);
  }

  // Collecting: the only slot left to fill is who it is for.
  const name = trimmed.replace(/[.!]+$/, "").trim();
  if (!name) return ask(draft, "Who is this order for?", ["customerName"]);
  return continueDraft({ ...draft, customerName: name });
}

function candidateList(candidates: QuickEntryCustomerCandidate[]): string {
  return candidates.map((c, i) => `${i + 1}. ${c.name}`).join(", ");
}

/** Which of several customers a name meant: by number, or by a name only one of them has. */
function chooseCustomer(draft: QuickEntryDraft, text: string): QuickEntryTurnResult {
  const candidates = draft.customerCandidates ?? [];
  const again = () =>
    ask(
      draft,
      `Which ${draft.customerName}? ${candidateList(candidates)}. Say the number, or "none" to pick in the till.`,
      ["customer"],
    );
  if (NOBODY_RE.test(text)) {
    return continueDraft({ ...draft, customerId: null, customerResolved: true, customerCandidates: undefined });
  }
  const num = text.match(/^\s*(?:number\s*)?(\d+)\b/i);
  let picked: QuickEntryCustomerCandidate | undefined;
  if (num) {
    picked = candidates[Number(num[1]) - 1];
  } else {
    const said = text.replace(/[.!]+$/, "").trim().toLowerCase();
    const exact = candidates.filter((c) => c.name.toLowerCase() === said);
    const partial = candidates.filter((c) => said.length > 0 && c.name.toLowerCase().includes(said));
    picked = exact.length === 1 ? exact[0] : partial.length === 1 ? partial[0] : undefined;
  }
  if (!picked) return again();
  return continueDraft({
    ...draft,
    customerName: picked.name,
    customerId: picked.id,
    customerResolved: true,
    customerCandidates: undefined,
  });
}

/**
 * Applies the customers a spoken name matched (looked up by the caller):
 * one is used, none leaves the customer to be picked in the till, several
 * are asked about — never guessed, and never created from a name.
 */
export function applyCustomerMatches(
  draft: QuickEntryDraft,
  candidates: QuickEntryCustomerCandidate[],
): QuickEntryTurnResult {
  if (candidates.length === 1) {
    return continueDraft({
      ...draft,
      customerName: candidates[0].name,
      customerId: candidates[0].id,
      customerResolved: true,
    });
  }
  if (candidates.length === 0) {
    return continueDraft({ ...draft, customerId: null, customerResolved: true });
  }
  const choosing: QuickEntryDraft = { ...draft, status: "choosing-customer", customerCandidates: candidates };
  return ask(
    choosing,
    `More than one customer matches ${draft.customerName}: ${candidateList(candidates)}. Which one?`,
    ["customer"],
  );
}

/** True when the draft names a customer that has not been looked up yet. */
export function needsCustomerLookup(draft: QuickEntryDraft | null | undefined): draft is QuickEntryDraft {
  return !!draft && !!draft.customerName && !draft.customerResolved && draft.status !== "choosing-customer";
}

/** Decides the next prompt for a draft that just changed. */
function continueDraft(draft: QuickEntryDraft): QuickEntryTurnResult {
  if (!draft.customerName) {
    return ask({ ...draft, status: "collecting" }, "Who is this order for?", ["customerName"]);
  }
  if (!draft.customerResolved) {
    // The caller looks the name up and calls applyCustomerMatches().
    return ask({ ...draft, status: "collecting" }, "Looking up the customer…", ["customer"]);
  }
  const confirming: QuickEntryDraft = { ...draft, status: "confirming" };
  const message = buildConfirmationMessage(confirming);
  return { action: "ask", draft: confirming, message, voiceResponse: message, missingFields: [] };
}
