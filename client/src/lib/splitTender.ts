/**
 * The split-payment rows on the till.
 *
 * Owner bug, Sept 2026: two sales taken as "£200 cash, £50 on credit" landed
 * as cash + CARD and never reached the credit list. Switching Split on used to
 * pre-fill the second row with "Card"; the cashier typed the amounts and never
 * touched the dropdown. A row now starts with no method at all, and the sale
 * cannot go through until every row that carries money says how it was paid.
 */
export type SplitLeg = { method: string; amount: string };

/** Methods a split row can carry (gift card and personal use have their own flows). */
export const SPLIT_METHODS = ["cash", "card", "card_link", "transfer", "tick"] as const;

/**
 * Rows for a split that is just being switched on. The first is cash (almost
 * every split has a cash part); the second is left unchosen — unless the
 * cashier had already picked another split-able method before flicking the
 * switch, in which case that is what they meant the rest to be.
 */
export function freshSplitLegs(currentMethod?: string): SplitLeg[] {
  const seed =
    currentMethod && currentMethod !== "cash" && (SPLIT_METHODS as readonly string[]).includes(currentMethod)
      ? currentMethod
      : "";
  return [
    { method: "cash", amount: "" },
    { method: seed, amount: "" },
  ];
}

/** True when some row has an amount but nobody said how it was paid. */
export function hasUnchosenMethod(legs: SplitLeg[]): boolean {
  return legs.some((leg) => Number(leg.amount) > 0 && !leg.method);
}
