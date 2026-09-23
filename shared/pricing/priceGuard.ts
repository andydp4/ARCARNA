import { z } from "zod";
import { netLineTotals, type OrderDiscounts } from "./lineSnapshot";

/**
 * Price guard at the till (v1.2 Phase 4: PRC-02, CMP-05). Warn and confirm,
 * never block.
 *
 * One rule for the till and the server, so the line the cashier was warned
 * about is exactly the line the server expects a confirmation for:
 *  - checked in pence, on the unit price (a weighed item is judged per kg,
 *    whatever quantity is on the scale);
 *  - below the minimum-only floor (owner Q4: the till never carries cost);
 *  - £0 on a product that has a price is always below;
 *  - more than 3× the list price is a likely typo: "did you mean", no flag.
 *
 * Below cost is never part of this: it is detected on the server after all
 * discounts and goes to managers without the cashier being told.
 */

export const PRICE_GUARD_REASONS = [
  "trade",
  "price_match",
  "damaged",
  "multibuy",
  "manager_agreed",
  "other",
] as const;
export type PriceGuardReason = (typeof PRICE_GUARD_REASONS)[number];

export const PRICE_GUARD_REASON_LABELS: Record<PriceGuardReason, string> = {
  trade: "Trade customer",
  price_match: "Price match",
  damaged: "Damaged or short-dated",
  multibuy: "Multi-buy or bundle",
  manager_agreed: "Manager agreed",
  other: "Other",
};

export function isPriceGuardReason(value: unknown): value is PriceGuardReason {
  return typeof value === "string" && (PRICE_GUARD_REASONS as readonly string[]).includes(value);
}

/** A price this many times the list price or more is probably a slipped decimal point. */
export const DID_YOU_MEAN_MULTIPLE = 3;

function pence(n: number | string | null | undefined): number {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) : 0;
}

export type TillPriceCheck =
  | { kind: "below"; floor: number }
  | { kind: "did_you_mean"; suggestion: number }
  | null;

/** Whether a keyed unit price is below the till floor (see the rule above). */
export function isBelowTillFloor(unitPrice: number, floor: number | null | undefined, listPrice: number | null | undefined): boolean {
  const unit = pence(unitPrice);
  if (unit <= 0 && pence(listPrice) > 0) return true;
  if (floor == null) return false;
  return unit < pence(floor);
}

/**
 * What a slipped decimal point most likely meant: the price divided by 10 or
 * 100, whichever lands nearest the list price. The list price itself when
 * neither lands within half as much again of it.
 */
export function didYouMeanPrice(unitPrice: number, listPrice: number): number {
  const list = pence(listPrice);
  const candidates = [pence(unitPrice) / 10, pence(unitPrice) / 100].map((p) => Math.round(p));
  let best = list;
  let bestRatio = Infinity;
  for (const c of candidates) {
    if (c <= 0) continue;
    const ratio = Math.max(c, list) / Math.min(c, list);
    if (ratio < bestRatio) {
      best = c;
      bestRatio = ratio;
    }
  }
  // Close to list or it is not a slipped decimal: £20 for a £5 item is not "£2".
  return (bestRatio <= 1.5 ? best : list) / 100;
}

/** The till's one check, run on the price the cashier left the box with. */
export function checkTillPrice(args: {
  unitPrice: number;
  floor: number | null | undefined;
  listPrice: number | null | undefined;
}): TillPriceCheck {
  const { unitPrice, floor, listPrice } = args;
  if (isBelowTillFloor(unitPrice, floor, listPrice)) {
    return { kind: "below", floor: Math.max(0, Number(floor) || 0) };
  }
  const list = pence(listPrice);
  if (list > 0 && pence(unitPrice) > DID_YOU_MEAN_MULTIPLE * list) {
    return { kind: "did_you_mean", suggestion: didYouMeanPrice(unitPrice, Number(listPrice)) };
  }
  return null;
}

/** The one amber line (owner Q4: one warning state, the lowest price, never cost). */
export function belowFloorMessage(floor: number): string {
  return `Below the lowest price for this item (£${floor.toFixed(2)}). You can still sell at this price; a manager will see it.`;
}

// ---------------------------------------------------------------------------
// The confirmation the till sends with the sale (and stores in a queued one).
// ---------------------------------------------------------------------------

export const priceGuardConfirmationSchema = z.object({
  reason: z.enum(PRICE_GUARD_REASONS),
  note: z.string().trim().max(500).optional(),
  /** "Manager agreed": the manager named, who is then asked. */
  managerUserId: z.string().trim().min(1).max(255).optional(),
  /** The flagged lines the cashier saw and confirmed, at the price confirmed. */
  lines: z
    .array(z.object({ productId: z.string().min(1).max(64), unitPrice: z.number().nonnegative().finite() }))
    .max(500),
  /** When the cashier pressed "Confirm and take payment" (the till's clock). */
  confirmedAt: z.string().max(40).optional(),
});
export type PriceGuardConfirmation = z.infer<typeof priceGuardConfirmationSchema>;

export const OTHER_NOTE_MIN = 3;

/** What is missing from a confirmation for it to count, or null when it is complete. */
export function confirmationProblem(c: Pick<PriceGuardConfirmation, "reason" | "note" | "managerUserId">): string | null {
  if (c.reason === "other" && (c.note ?? "").trim().length < OTHER_NOTE_MIN) return "Say what the reason is.";
  if (c.reason === "manager_agreed" && !c.managerUserId) return "Say which manager agreed.";
  return null;
}

/** Reads `body.priceGuard`. Anything malformed is treated as no confirmation: the sale is never refused for it. */
export function readConfirmation(raw: unknown): PriceGuardConfirmation | null {
  if (raw == null) return null;
  const parsed = priceGuardConfirmationSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// The server's verdict on one order.
// ---------------------------------------------------------------------------

export type GuardLine = {
  productId: string;
  quantity: number;
  unitPrice: number;
  /** Snapshot taken when the line was sold (order_items). Null: no snapshot. */
  listPrice: number | null;
  /** The minimum as it applied — the till's floor. */
  floorPrice: number | null;
  unitCost: number | null;
};

export type GuardFlaggedLine = {
  productId: string;
  quantity: number;
  unitPrice: number;
  floorPrice: number;
  listPrice: number;
  /** £ under the minimum across the line's quantity. */
  underMinimum: number;
  /** The keyed price itself was below the floor: the till warned and asked for a reason. */
  needsConfirmation: boolean;
  confirmed: boolean;
};

export type OrderGuardVerdict = {
  /** Lines below the minimum, keyed or after the order's discounts. */
  flagged: GuardFlaggedLine[];
  underMinimum: number;
  /** Lines the till should have asked about. */
  needsConfirmation: number;
  /** Every such line was confirmed with a complete reason. Null when none needed one. */
  confirmed: boolean | null;
  linesBelowCost: number;
  /** The products of those lines (managers' use only; never sent to a till). */
  belowCostProductIds: string[];
  /** After all discounts, the known-cost lines brought in less than they cost. */
  orderBelowCost: boolean;
  /** £ under cost: the order-level shortfall, or the lines' own when larger. */
  underCost: number;
  /** Anything a manager should hear about. */
  any: boolean;
};

const money = (p: number) => Math.round(p) / 100;

/**
 * The order-level check (PRC-02, owner Q3): every line below its minimum, and
 * below cost after ALL discounts — tier, promotion and points shared over the
 * lines by value, the same way the silent recorder judges them. A line whose
 * keyed price was below the floor needs the till's confirmation; a line pushed
 * below by the order's discounts, and anything below cost, is the manager's
 * to see and never the cashier's.
 */
export function evaluateOrderGuard(
  lines: GuardLine[],
  pricing: OrderDiscounts | null | undefined,
  confirmation: PriceGuardConfirmation | null,
): OrderGuardVerdict {
  const nets = netLineTotals(lines, pricing);
  const complete = !!confirmation && confirmationProblem(confirmation) == null;
  const confirmedKeys = new Set(
    (complete ? confirmation!.lines : []).map((l) => `${l.productId}|${pence(l.unitPrice)}`),
  );
  const flagged: GuardFlaggedLine[] = [];
  let knownNet = 0;
  let knownCost = 0;
  let linesBelowCost = 0;
  const belowCostProductIds: string[] = [];
  let lineShortfall = 0;
  lines.forEach((line, i) => {
    const qty = Number(line.quantity) || 0;
    if (qty <= 0) return;
    const net = pence(nets[i]);
    if (line.unitCost != null) {
      const cost = pence(line.unitCost) * qty;
      knownNet += net;
      knownCost += cost;
      if (net < cost) {
        linesBelowCost += 1;
        belowCostProductIds.push(line.productId);
        lineShortfall += cost - net;
      }
    }
    if (line.floorPrice == null) return;
    const list = line.listPrice ?? line.floorPrice;
    const keyedBelow = isBelowTillFloor(line.unitPrice, line.floorPrice, list);
    const floorTotal = pence(line.floorPrice) * qty;
    if (!keyedBelow && net >= floorTotal) return;
    flagged.push({
      productId: line.productId,
      quantity: qty,
      unitPrice: line.unitPrice,
      floorPrice: line.floorPrice,
      listPrice: list,
      underMinimum: money(Math.max(0, floorTotal - net)),
      needsConfirmation: keyedBelow,
      confirmed: keyedBelow && confirmedKeys.has(`${line.productId}|${pence(line.unitPrice)}`),
    });
  });
  const needing = flagged.filter((f) => f.needsConfirmation);
  const orderBelowCost = knownNet < knownCost;
  const underCost = money(Math.max(orderBelowCost ? knownCost - knownNet : 0, lineShortfall));
  return {
    flagged,
    underMinimum: money(flagged.reduce((s, f) => s + pence(f.underMinimum), 0)),
    needsConfirmation: needing.length,
    confirmed: needing.length === 0 ? null : needing.every((f) => f.confirmed),
    linesBelowCost,
    belowCostProductIds,
    orderBelowCost,
    underCost,
    any: flagged.length > 0 || linesBelowCost > 0 || orderBelowCost,
  };
}

/**
 * The Signal's one line (PRC-04), e.g. "£6.40 under minimum on order #1A2B3C4D
 * by Sam: 2 lines, reason: Trade customer". Below cost is added only to the
 * managers' Signal text; the cashier is never a recipient.
 */
export function priceGuardSignalLine(args: {
  verdict: OrderGuardVerdict;
  orderRef: string;
  who: string;
  reason: PriceGuardReason | null;
  note?: string | null;
  managerName?: string | null;
  /** A manager's edit after the sale, not the till: no reason was asked. */
  edited?: boolean;
}): string {
  const { verdict, orderRef, who } = args;
  const by = args.edited ? `edited by ${who}` : `by ${who}`;
  const parts: string[] = [];
  if (verdict.flagged.length > 0) {
    const n = verdict.flagged.length;
    let reason = "no reason given (unconfirmed)";
    if (args.edited) reason = "price changed after the sale";
    else if (verdict.confirmed === null && !args.reason) reason = "pushed below by the order's discounts";
    else if (args.reason) {
      reason = PRICE_GUARD_REASON_LABELS[args.reason];
      if (args.reason === "manager_agreed" && args.managerName) reason += `: ${args.managerName}`;
      if (args.reason === "other" && args.note) reason += `: ${args.note}`;
      if (verdict.confirmed === false) reason += " (not every line confirmed)";
    }
    parts.push(
      `£${verdict.underMinimum.toFixed(2)} under minimum on order ${orderRef} ${by}: ${n} ${n === 1 ? "line" : "lines"}, reason: ${reason}.`,
    );
  }
  if (verdict.linesBelowCost > 0 || verdict.orderBelowCost) {
    parts.push(
      verdict.flagged.length > 0
        ? `Also £${verdict.underCost.toFixed(2)} below cost after discounts.`
        : `£${verdict.underCost.toFixed(2)} below cost after discounts on order ${orderRef} ${by}.`,
    );
  }
  return parts.join(" ");
}

export function orderRefOf(orderId: string): string {
  return `#${orderId.slice(0, 8).toUpperCase()}`;
}
