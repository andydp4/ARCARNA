/**
 * "Card (link)" at the till (v1.2 Stripe links): the rules both sides share.
 *
 * Tills are phones and Macs running arcarna in a browser, so there is no card
 * reader to talk to. Instead a card payment can be a Stripe Checkout link the
 * customer opens on their own phone (a QR on the till, or sent by WhatsApp).
 * The sale is recorded straight away; its card-link leg stays `awaiting` until
 * Stripe's signed webhook says the money arrived. Nothing here touches the
 * network or the database.
 */

/** The tender value for a card-link leg. Contains "card", so takings bucket it as Card. */
export const CARD_LINK_METHOD = "card_link";

/** Leg states in `order_payments.status`. */
export const PAYMENT_STATUS_PAID = "paid";
export const PAYMENT_STATUS_AWAITING = "awaiting";

/** Stripe will not take a GBP payment under 30p. */
export const CARD_LINK_MIN_AMOUNT = 0.3;

/** A Checkout Session lasts between 30 minutes and 24 hours (Stripe's limits). */
export const CARD_LINK_MIN_MINUTES = 30;
export const CARD_LINK_MAX_MINUTES = 24 * 60;

/** What the till can switch an unpaid card link to. */
export const CARD_LINK_RETENDER_METHODS = ["cash", "card", "transfer"] as const;
export type CardLinkRetenderMethod = (typeof CARD_LINK_RETENDER_METHODS)[number];

export function isCardLinkMethod(method: string | null | undefined): boolean {
  return String(method ?? "").toLowerCase() === CARD_LINK_METHOD;
}

/** Only a leg that is actually paid is money taken. Legs from before migration 140 have no status: paid. */
export function isPaidLeg(leg: { status?: string | null }): boolean {
  return (leg.status ?? PAYMENT_STATUS_PAID) === PAYMENT_STATUS_PAID;
}

/** How a tender reads to people. Terminal card and card link are kept apart so each reconciles against its own statement. */
export function paymentMethodLabel(method: string | null | undefined): string {
  const m = String(method ?? "").toLowerCase();
  switch (m) {
    case "cash":
      return "Cash";
    case "card":
      return "Card";
    case CARD_LINK_METHOD:
      return "Card (link)";
    case "transfer":
      return "Transfer";
    case "tick":
      return "On credit";
    case "gift_card":
      return "Gift card";
    case "personal_use":
      return "Personal use";
    case "split":
      return "Split";
    default:
      return method ? String(method) : "Unknown";
  }
}

/** Pounds to Stripe's minor units (pence), to the penny. */
export function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

export function clampLinkMinutes(minutes: number | null | undefined): number {
  const n = Number(minutes);
  if (!Number.isFinite(n)) return CARD_LINK_MIN_MINUTES;
  return Math.min(CARD_LINK_MAX_MINUTES, Math.max(CARD_LINK_MIN_MINUTES, Math.round(n)));
}

export type CardLinkSaleInput = {
  paymentMethod: string | null | undefined;
  legs: Array<{ method: string; amount: number }> | null;
  /** Stripe keys are set on the server. */
  configured: boolean;
  /** A sale queued on the till while offline and sent later. */
  offline: boolean;
  backdated: boolean;
  usesGiftCard: boolean;
  remainderPaymentMethod?: string | null;
  isPersonalUse: boolean;
};

/**
 * Why a sale using Card (link) cannot be recorded, or null when it can (or
 * does not use it). Checked on the server before the order is written.
 */
export function cardLinkSaleRefusal(input: CardLinkSaleInput): string | null {
  const legs = input.legs ?? [];
  const linkLegs = legs.filter((l) => isCardLinkMethod(l.method));
  const uses =
    isCardLinkMethod(input.paymentMethod) || linkLegs.length > 0 || isCardLinkMethod(input.remainderPaymentMethod);
  if (!uses) return null;
  if (!input.configured) return "Card (link) is not set up. Choose another way to pay.";
  if (input.isPersonalUse) return "Personal use is not a sale, so there is nothing to pay by card link.";
  if (input.usesGiftCard || isCardLinkMethod(input.remainderPaymentMethod)) {
    return "Card (link) cannot be combined with a gift card. Use a split instead.";
  }
  // The customer has to be sent a link while the sale is live; a queued
  // offline sale or a day keyed in afterwards has no customer to pay it.
  if (input.offline) return "Card (link) needs a connection. Choose another way to pay.";
  if (input.backdated) return "Card (link) cannot be used on a sale dated in the past.";
  if (linkLegs.length > 1) return "Only one part of a split can be paid by card link.";
  if (linkLegs.length === 1 && linkLegs[0].amount < CARD_LINK_MIN_AMOUNT) {
    return `A card link must be at least £${CARD_LINK_MIN_AMOUNT.toFixed(2)}.`;
  }
  return null;
}

export type SessionCheck = {
  amountMinor: number | null | undefined;
  currency: string | null | undefined;
  orderId: string | null | undefined;
};

/**
 * Whether what Stripe says was paid is exactly what the leg is for. Anything
 * else — a different amount, a different currency, another order's metadata —
 * is not marked paid; a person looks at it.
 */
export function sessionMismatch(
  expected: { amount: number; currency: string; orderId: string },
  got: SessionCheck,
): string | null {
  if (got.amountMinor !== toMinorUnits(expected.amount)) {
    const paid = typeof got.amountMinor === "number" ? (got.amountMinor / 100).toFixed(2) : "an unknown amount";
    return `Stripe says ${paid} was paid but the card link was for ${expected.amount.toFixed(2)}`;
  }
  if (String(got.currency ?? "").toLowerCase() !== expected.currency.toLowerCase()) {
    return `Stripe says it was paid in ${String(got.currency ?? "unknown").toUpperCase()} but the card link was in ${expected.currency.toUpperCase()}`;
  }
  if (got.orderId && got.orderId !== expected.orderId) {
    return "Stripe's payment names a different order from the card link";
  }
  return null;
}
