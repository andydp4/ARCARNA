/**
 * Hand-off for WhatsApp "create draft order" (and the voice assistant's
 * drafts) → POS prefill.
 *
 * The panel stashes the suggested items (and linked customer) in sessionStorage,
 * then navigates to /pos, which consumes it once on mount. No order is created
 * until the user confirms checkout (Principle 14).
 */
import {
  STORAGE_WHATSAPP_DRAFT,
  STORAGE_WHATSAPP_DRAFT_LEGACY,
} from "@shared/storageKeys";

function migrateDraftKey(): void {
  if (typeof sessionStorage === "undefined") return;
  if (sessionStorage.getItem(STORAGE_WHATSAPP_DRAFT) !== null) return;
  const legacy = sessionStorage.getItem(STORAGE_WHATSAPP_DRAFT_LEGACY);
  if (legacy !== null) {
    sessionStorage.setItem(STORAGE_WHATSAPP_DRAFT, legacy);
    sessionStorage.removeItem(STORAGE_WHATSAPP_DRAFT_LEGACY);
  }
}

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
  /**
   * Where the draft came from. The voice assistant uses the same hand-off
   * (v1.2 Phase 1B): its drafts open in the till instead of being saved.
   * Absent means WhatsApp.
   */
  source?: "whatsapp" | "voice";
  /** A spoken name nobody on file matched, for the cashier to pick. */
  customerName?: string | null;
}

export function stashWhatsappDraft(draft: WhatsappDraftOrder): void {
  try {
    sessionStorage.setItem(STORAGE_WHATSAPP_DRAFT, JSON.stringify(draft));
  } catch {
    /* ignore storage failures */
  }
}

/** Read and clear the pending draft (consume-once). */
export function consumeWhatsappDraft(): WhatsappDraftOrder | null {
  try {
    migrateDraftKey();
    const raw = sessionStorage.getItem(STORAGE_WHATSAPP_DRAFT);
    if (!raw) return null;
    sessionStorage.removeItem(STORAGE_WHATSAPP_DRAFT);
    return JSON.parse(raw) as WhatsappDraftOrder;
  } catch {
    return null;
  }
}
