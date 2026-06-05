/**
 * Hand-off for WhatsApp "create draft order" → POS prefill.
 *
 * The panel stashes the suggested items (and linked customer) in sessionStorage,
 * then navigates to /pos, which consumes it once on mount. No order is created
 * until the user confirms checkout (Principle 14).
 */
const KEY = "midnight.whatsapp.draftOrder";

export interface WhatsappDraftItem {
  productId?: string;
  sku?: string;
  name: string;
  quantity: number;
}

export interface WhatsappDraftOrder {
  conversationId: string;
  customerId: string | null;
  note?: string;
  items: WhatsappDraftItem[];
}

export function stashWhatsappDraft(draft: WhatsappDraftOrder): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    /* ignore storage failures */
  }
}

/** Read and clear the pending draft (consume-once). */
export function consumeWhatsappDraft(): WhatsappDraftOrder | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    return JSON.parse(raw) as WhatsappDraftOrder;
  } catch {
    return null;
  }
}
