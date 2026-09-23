/**
 * Edit, from Needs attention (v1.2 Phase 1A): the manager opens a refused sale
 * in the till, fixes it, and takes payment again. The page stashes the sale
 * here and navigates to the till, which reads it once — the same hand-off the
 * WhatsApp draft uses. Nothing is sent until the manager confirms payment, and
 * the sale keeps its own reference, so it can never land twice.
 */
import { STORAGE_SALE_ISSUE_DRAFT } from "@shared/storageKeys";

export interface SaleIssueDraft {
  issueId: string;
  clientOrderId: string;
  rungByName: string | null;
  payload: Record<string, unknown>;
}

export function stashSaleIssueDraft(draft: SaleIssueDraft): void {
  try {
    sessionStorage.setItem(STORAGE_SALE_ISSUE_DRAFT, JSON.stringify(draft));
  } catch {
    /* storage refused: the page says so when the till opens empty */
  }
}

/** Read and clear the pending draft (consume-once). */
export function consumeSaleIssueDraft(): SaleIssueDraft | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_SALE_ISSUE_DRAFT);
    if (!raw) return null;
    sessionStorage.removeItem(STORAGE_SALE_ISSUE_DRAFT);
    const parsed = JSON.parse(raw) as SaleIssueDraft;
    return parsed && typeof parsed.issueId === "string" && typeof parsed.clientOrderId === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export type DraftLine = { productId: string; quantity: number; unitPrice: number };

/**
 * The parts of a stored sale the till can put back on screen. Gift-card,
 * points and promotion redemptions are not restored: each moves a balance or
 * a usage count, so the manager applies them again deliberately (`dropped`
 * says which were left out).
 */
export function readSaleIssuePayload(payload: Record<string, unknown>): {
  lines: DraftLine[];
  customerId: string | null;
  paymentMethod: string | null;
  payments: Array<{ method: string; amount: number }> | null;
  fulfilmentMethod: "collection" | "delivery";
  /** Where a delivery goes (v1.2 Phase 5): carried back to the till with the sale. */
  delivery: { address: string; postcode: string; notes: string };
  channel: string | null;
  personalUseReason: string | null;
  orderDate: string | null;
  expenses: Array<{ category: string; description: string; amount: number }>;
  dropped: string[];
} {
  const lines: DraftLine[] = Array.isArray(payload.lines)
    ? (payload.lines as unknown[]).flatMap((l) => {
        const line = l as { productId?: unknown; quantity?: unknown; unitPrice?: unknown };
        const quantity = Number(line.quantity);
        const unitPrice = Number(line.unitPrice);
        return typeof line.productId === "string" && Number.isFinite(quantity) && quantity > 0 && Number.isFinite(unitPrice)
          ? [{ productId: line.productId, quantity, unitPrice }]
          : [];
      })
    : [];
  const payments = Array.isArray(payload.payments)
    ? (payload.payments as unknown[]).flatMap((p) => {
        const leg = p as { method?: unknown; amount?: unknown };
        const amount = Number(leg.amount);
        return typeof leg.method === "string" && Number.isFinite(amount) ? [{ method: leg.method, amount }] : [];
      })
    : null;
  const expenses = Array.isArray(payload.expenses)
    ? (payload.expenses as unknown[]).flatMap((e) => {
        const x = e as { category?: unknown; description?: unknown; amount?: unknown };
        const amount = Number(x.amount);
        return typeof x.category === "string" && Number.isFinite(amount)
          ? [{ category: x.category, description: typeof x.description === "string" ? x.description : "", amount }]
          : [];
      })
    : [];
  const dropped: string[] = [];
  if (payload.giftCardCode) dropped.push("gift card");
  if (Number(payload.redeemPoints) > 0) dropped.push("points");
  // A promotion's use is counted when the sale lands; re-applied deliberately.
  if (payload.promoCode) dropped.push("promotion");
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    lines,
    customerId: str(payload.customerId),
    paymentMethod: str(payload.paymentMethod),
    payments: payments && payments.length > 0 ? payments : null,
    fulfilmentMethod: payload.fulfilmentMethod === "delivery" ? "delivery" : "collection",
    delivery: {
      address: str(payload.deliveryAddress) ?? "",
      postcode: str(payload.deliveryPostcode) ?? "",
      notes: str(payload.deliveryNotes) ?? "",
    },
    channel: str(payload.channel),
    personalUseReason: str(payload.personalUseReason),
    orderDate: str(payload.orderDate),
    expenses,
    dropped,
  };
}

/** What the stored sale came to, for the Needs attention list: lines only, before any discount. */
export function saleIssueLinesTotal(payload: Record<string, unknown>): number {
  const { lines } = readSaleIssuePayload(payload);
  return Math.round(lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0) * 100) / 100;
}
