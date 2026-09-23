import { parseQuantityInput, roundQuantity } from "@shared/quantity";

/**
 * Pure helpers behind the purchase-draft line editor and the over-delivery
 * confirmation (client/src/pages/purchase-drafts.tsx,
 * client/src/components/inventory/ReceivingTab.tsx). Kept out of the page so
 * the rules that decide "what gets saved" and "what the manager confirmed" are
 * testable on their own (client/src/lib/__tests__/purchaseDraftEdits.test.ts).
 */

/**
 * A typed unit cost: blank means "no cost of its own — price from the
 * supplier link or product card"; otherwise a positive amount in pounds with
 * at most two decimal places. Zero, sub-penny and exponent forms ("1e3") are
 * refused rather than accepted and then silently ignored or rounded to £0.00.
 */
export function parseCostInput(raw: string): { ok: true; value: number | null } | { ok: false } {
  const trimmed = raw.trim().replace(/^£\s*/, "");
  if (trimmed === "") return { ok: true, value: null };
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(trimmed)) return { ok: false };
  const value = Number(trimmed);
  return value > 0 ? { ok: true, value } : { ok: false };
}

export type SavedLine = { quantity: number; estimatedCost?: string | null };

/**
 * What the typed-but-unsaved fields on a line would change, against the last
 * value known to be saved. `undefined` fields are unchanged.
 */
export function pendingLineChange(
  saved: SavedLine,
  qtyRaw: string | undefined,
  costRaw: string | undefined,
): {
  quantity?: number;
  estimatedCost?: number | null;
  invalid: "quantity" | "cost" | null;
} {
  let quantity: number | undefined;
  let estimatedCost: number | null | undefined;
  let invalid: "quantity" | "cost" | null = null;

  if (qtyRaw !== undefined) {
    const parsed = parseQuantityInput(qtyRaw);
    if (parsed === null) invalid = "quantity";
    else if (parsed !== saved.quantity) quantity = parsed;
  }
  if (costRaw !== undefined) {
    const parsed = parseCostInput(costRaw);
    const current = saved.estimatedCost != null ? Number(saved.estimatedCost) : null;
    if (!parsed.ok) invalid = invalid ?? "cost";
    else if (parsed.value !== current) estimatedCost = parsed.value;
  }
  return { quantity, estimatedCost, invalid };
}

export type ReceiveLine = { id: string; remaining: number; received: string | undefined };

/** How far over what is still outstanding a typed receipt quantity is (0 when it fits). */
export function receiveExcess(line: Pick<ReceiveLine, "remaining" | "received">): number {
  const received = parseQuantityInput(line.received ?? "");
  if (received === null) return 0;
  return Math.max(0, roundQuantity(received - line.remaining));
}

export function overDeliveredLines<T extends ReceiveLine>(lines: T[]): (T & { excess: number })[] {
  return lines
    .map((line) => ({ ...line, excess: receiveExcess(line) }))
    .filter((line) => line.excess > 0);
}

/**
 * Identifies exactly WHICH lines are over, and by how much. The manager's
 * confirmation is stored against this key, so it lapses by itself the moment
 * any over-delivered quantity changes or another line goes over — a tick
 * given for "40 over on line A" can never carry a later typo, or a line the
 * manager never saw, through to the server.
 */
export function overDeliveryKey(lines: ReceiveLine[]): string {
  return overDeliveredLines(lines)
    .map((line) => `${line.id}:${line.received?.trim()}`)
    .sort()
    .join("|");
}
