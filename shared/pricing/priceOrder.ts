/**
 * One price for a sale (v1.2 Phase 1B): the till's display — online and
 * offline — and the server's record both come from this function, so what the
 * customer is shown is what every tender is checked against and what the
 * order stores.
 *
 * Order of application, in pence so no float drift reaches a total:
 *   1. subtotal        = Σ line totals (each rounded to the penny, as stored)
 *   2. tier discount   = the customer's loyalty tier % of the subtotal
 *   3. promo discount  = the promotion, also on the subtotal (both are shown to
 *                        the customer against the subtotal, so they do not
 *                        compound), capped by its "max discount" and by what
 *                        is left to discount
 *   4. VAT             = org rate × (subtotal − tier − promo). Prices are VAT
 *                        exclusive, as the engine always treated them.
 *   5. points          = owner Q2: £5 of points is £5 off what the customer
 *                        pays AFTER VAT, never off the pre-VAT price
 *   6. total           = subtotal − tier − promo + VAT − points
 *
 * Refusals are thrown as `PricingError` with a message a cashier can act on;
 * the server turns them into a refused sale, the till shows them before the
 * sale is sent.
 */

export class PricingError extends Error {
  readonly code: PricingErrorCode;
  constructor(message: string, code: PricingErrorCode) {
    super(message);
    this.name = "PricingError";
    this.code = code;
  }
}

export type PricingErrorCode =
  | "PROMO_NOT_ACTIVE"
  | "PROMO_NOT_STARTED"
  | "PROMO_EXPIRED"
  | "PROMO_USED_UP"
  | "PROMO_MIN_SPEND"
  | "PROMO_TIER_REQUIRED"
  | "PROMO_CUSTOMER_REQUIRED"
  | "PROMO_TYPE_UNSUPPORTED"
  | "POINTS_CUSTOMER_REQUIRED"
  | "POINTS_INVALID"
  | "POINTS_BELOW_MINIMUM"
  | "POINTS_INSUFFICIENT"
  | "POINTS_EXCEED_TOTAL";

export type PricingLine = { quantity: number; unitPrice: number };

export type PricingTier = {
  id?: string | null;
  name: string;
  pointsRequired: number;
  /** Percentage, e.g. 10 for 10%. numeric columns arrive as strings. */
  discountPercentage?: number | string | null;
};

export type PricingPromotion = {
  id?: string | null;
  code?: string | null;
  name: string;
  /** percentage | fixed are priced; bogo and points are not priceable yet. */
  type: string;
  value: number | string;
  minPurchase?: number | string | null;
  maxDiscount?: number | string | null;
  startDate: Date | string;
  endDate: Date | string;
  isActive: number | boolean;
  usageLimit?: number | null;
  usageCount?: number | null;
  tierRequired?: string | null;
};

export type PricingPoints = {
  points: number;
  /** £ per point, e.g. 0.01 = £1 per 100 points. */
  redemptionRate: number;
  minRedeemPoints: number;
  /** The customer's balance before this sale. */
  balance: number;
};

export type PriceOrderInput = {
  lines: PricingLine[];
  /** Org VAT rate as a percentage (0 while the shop is not VAT registered). */
  taxRatePercent: number;
  /** Customer's loyalty balance, when a customer is on the sale. */
  customer?: { loyaltyPoints: number } | null;
  /** The org's tiers; the customer's tier is derived from their balance. */
  tiers?: PricingTier[];
  promotion?: PricingPromotion | null;
  points?: PricingPoints | null;
  now?: Date;
};

export type PricedOrder = {
  subtotal: number;
  tier: { id: string | null; name: string; percent: number } | null;
  tierDiscount: number;
  promotion: { id: string | null; code: string | null; name: string } | null;
  promoDiscount: number;
  /** Subtotal less tier and promo — what VAT is charged on. */
  netAfterDiscounts: number;
  vatRate: number;
  vatAmount: number;
  pointsRedeemed: number;
  pointsDiscount: number;
  /** Tier + promo + points: the shift report's "discounts". */
  discountTotal: number;
  /** What the customer is charged. Every tender must add up to this. */
  total: number;
  /** Loyalty earned on what was paid (see pointsEarnedFor). */
  pointsEarned: number;
};

/** Points earned per £1 actually paid. The loyalty worker uses the same rule. */
export const POINTS_PER_POUND = 1;

/** Loyalty earned on what the customer paid — after every discount and points. */
export function pointsEarnedFor(totalPaid: number): number {
  if (!Number.isFinite(totalPaid) || totalPaid <= 0) return 0;
  // Pence first: 19.99 * 1 must not floor to 19 through 19.989999.
  return Math.floor(toPence(totalPaid * POINTS_PER_POUND) / 100);
}

function num(v: number | string | null | undefined): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function toPence(pounds: number): number {
  // toPrecision first so 1.005 → 101p, not 100p (1.005 * 100 = 100.49999…).
  return Math.round(Number((pounds * 100).toPrecision(12)));
}

function fromPence(pence: number): number {
  return pence / 100;
}

function pct(pence: number, percent: number): number {
  return Math.round((pence * percent) / 100);
}

/**
 * One line's total, rounded exactly as priceOrder() rounds it, so the stored
 * line totals add up to the subtotal charged (toFixed(2) would store 0.5 ×
 * £2.01 as £1.00 while the sale charged £1.01).
 */
export function lineTotalFor(quantity: number, unitPrice: number): number {
  return fromPence(toPence(quantity * unitPrice));
}

/** The customer's tier: the highest one whose threshold their balance reaches. */
export function tierForPoints(points: number, tiers: PricingTier[]): PricingTier | null {
  let best: PricingTier | null = null;
  for (const t of tiers) {
    if (points >= t.pointsRequired && (!best || t.pointsRequired > best.pointsRequired)) best = t;
  }
  return best;
}

function formatMoney(pounds: number): string {
  return `£${pounds.toFixed(2)}`;
}

/**
 * Why this promotion cannot be used on this sale, or null when it can. The
 * server re-checks against the locked promotion row inside the sale, so a
 * code that expires or runs out between display and payment is still refused.
 */
export function promotionProblem(
  promo: PricingPromotion,
  ctx: { subtotal: number; customerTier: PricingTier | null; tiers: PricingTier[]; hasCustomer: boolean; now: Date },
): PricingError | null {
  const active = typeof promo.isActive === "boolean" ? promo.isActive : promo.isActive === 1;
  if (!active) return new PricingError(`${promo.name} is switched off.`, "PROMO_NOT_ACTIVE");
  const start = new Date(promo.startDate);
  const end = new Date(promo.endDate);
  if (ctx.now.getTime() < start.getTime()) {
    return new PricingError(`${promo.name} has not started yet.`, "PROMO_NOT_STARTED");
  }
  if (ctx.now.getTime() > end.getTime()) {
    return new PricingError(`${promo.name} has expired.`, "PROMO_EXPIRED");
  }
  if (promo.usageLimit != null && (promo.usageCount ?? 0) >= promo.usageLimit) {
    return new PricingError(`${promo.name} has been used up.`, "PROMO_USED_UP");
  }
  const minSpend = num(promo.minPurchase);
  if (minSpend > 0 && toPence(ctx.subtotal) < toPence(minSpend)) {
    return new PricingError(
      `${promo.name} needs a spend of ${formatMoney(minSpend)} before discounts.`,
      "PROMO_MIN_SPEND",
    );
  }
  if (promo.tierRequired) {
    if (!ctx.hasCustomer) {
      return new PricingError(`${promo.name} is for loyalty members. Pick the customer first.`, "PROMO_CUSTOMER_REQUIRED");
    }
    const required = ctx.tiers.find((t) => t.id === promo.tierRequired);
    // At that tier or above. A required tier that no longer exists cannot be met.
    if (!required || !ctx.customerTier || ctx.customerTier.pointsRequired < required.pointsRequired) {
      return new PricingError(
        `${promo.name} is for ${required?.name ?? "a loyalty tier"} members and above.`,
        "PROMO_TIER_REQUIRED",
      );
    }
  }
  if (promo.type !== "percentage" && promo.type !== "fixed") {
    // Buy-one-get-one and bonus-points promotions have no pricing rule yet;
    // applying them as a money-off (which the till used to) would charge
    // something nobody set.
    return new PricingError(`${promo.name} cannot be applied at the till yet.`, "PROMO_TYPE_UNSUPPORTED");
  }
  return null;
}

/** Why these points cannot be redeemed on this sale, or null when they can. */
export function pointsProblem(points: PricingPoints, grossPence: number): PricingError | null {
  if (!Number.isInteger(points.points) || points.points <= 0) {
    return new PricingError("Points must be a positive whole number.", "POINTS_INVALID");
  }
  if (points.points < points.minRedeemPoints) {
    return new PricingError(`Minimum redemption is ${points.minRedeemPoints} points.`, "POINTS_BELOW_MINIMUM");
  }
  if (points.points > points.balance) {
    return new PricingError(
      `The customer has ${points.balance} points, not ${points.points}.`,
      "POINTS_INSUFFICIENT",
    );
  }
  const value = toPence(points.points * points.redemptionRate);
  if (value > grossPence) {
    // Refused rather than capped: capping would take all the points for less
    // than they are worth.
    return new PricingError(
      `${points.points} points are worth ${formatMoney(fromPence(value))}, more than the ${formatMoney(
        fromPence(grossPence),
      )} to pay. Redeem fewer points.`,
      "POINTS_EXCEED_TOTAL",
    );
  }
  return null;
}

export function priceOrder(input: PriceOrderInput): PricedOrder {
  const now = input.now ?? new Date();
  const tiers = input.tiers ?? [];
  const subtotalP = input.lines.reduce((sum, l) => sum + toPence(l.quantity * l.unitPrice), 0);

  const customerTier = input.customer ? tierForPoints(input.customer.loyaltyPoints ?? 0, tiers) : null;
  const tierPercent = customerTier ? Math.min(100, Math.max(0, num(customerTier.discountPercentage))) : 0;
  const tierDiscountP = Math.min(subtotalP, pct(subtotalP, tierPercent));

  let promoDiscountP = 0;
  const promo = input.promotion ?? null;
  if (promo) {
    const problem = promotionProblem(promo, {
      subtotal: fromPence(subtotalP),
      customerTier,
      tiers,
      hasCustomer: !!input.customer,
      now,
    });
    if (problem) throw problem;
    const raw =
      promo.type === "percentage"
        ? pct(subtotalP, Math.min(100, Math.max(0, num(promo.value))))
        : toPence(Math.max(0, num(promo.value)));
    const cap = num(promo.maxDiscount) > 0 ? toPence(num(promo.maxDiscount)) : Infinity;
    promoDiscountP = Math.max(0, Math.min(raw, cap, subtotalP - tierDiscountP));
  }

  const netP = subtotalP - tierDiscountP - promoDiscountP;
  const vatRate = Math.max(0, num(input.taxRatePercent));
  const vatP = pct(netP, vatRate);
  const grossP = netP + vatP;

  let pointsDiscountP = 0;
  let pointsRedeemed = 0;
  if (input.points && input.points.points !== 0) {
    if (!input.customer) {
      throw new PricingError("Pick the customer before redeeming points.", "POINTS_CUSTOMER_REQUIRED");
    }
    const problem = pointsProblem(input.points, grossP);
    if (problem) throw problem;
    pointsRedeemed = input.points.points;
    pointsDiscountP = toPence(input.points.points * input.points.redemptionRate);
  }

  const totalP = grossP - pointsDiscountP;
  const total = fromPence(totalP);
  return {
    subtotal: fromPence(subtotalP),
    tier:
      customerTier && tierPercent > 0
        ? { id: customerTier.id ?? null, name: customerTier.name, percent: tierPercent }
        : null,
    tierDiscount: fromPence(tierDiscountP),
    promotion: promo ? { id: promo.id ?? null, code: promo.code ?? null, name: promo.name } : null,
    promoDiscount: fromPence(promoDiscountP),
    netAfterDiscounts: fromPence(netP),
    vatRate,
    vatAmount: fromPence(vatP),
    pointsRedeemed,
    pointsDiscount: fromPence(pointsDiscountP),
    discountTotal: fromPence(tierDiscountP + promoDiscountP + pointsDiscountP),
    total,
    pointsEarned: pointsEarnedFor(total),
  };
}

/**
 * A stored order's discounts (tier + promotion + points), read back from its
 * columns. NULL columns — orders from before the breakdown was recorded —
 * count as nothing known, i.e. 0.
 */
export function storedDiscountTotal(row: {
  tierDiscount?: string | number | null;
  promoDiscount?: string | number | null;
  pointsDiscount?: string | number | null;
}): number {
  return fromPence(toPence(num(row.tierDiscount)) + toPence(num(row.promoDiscount)) + toPence(num(row.pointsDiscount)));
}

/**
 * What a sale was given, read back from its order so a manager's edit keeps
 * it (v1.2 Phase 1B, "Manager edits"). The tier % and points are what the
 * customer earned or spent at the time; the promotion is re-applied by its own
 * rules to the new lines, without re-checking its dates or usage — its use was
 * counted when the sale was made.
 */
export type KeptDiscounts = {
  tier: { id: string | null; name: string; percent: number } | null;
  promotion:
    | {
        id: string | null;
        code: string | null;
        name: string;
        /** The promotion row as it is now; null when it has since been deleted. */
        rule: Pick<PricingPromotion, "type" | "value" | "maxDiscount"> | null;
        /** What the sale was actually given, used when the rule is gone. */
        storedDiscount: number;
      }
    | null;
  pointsRedeemed: number;
  pointsDiscount: number;
};

/**
 * Re-prices an edited order: new lines, the org's VAT rate, the same
 * discounts. Same order of application as priceOrder(). Points already spent
 * that would now be worth more than the order is refused rather than
 * shrunk: the points left the customer's balance at their full value.
 */
export function priceEditedOrder(input: {
  lines: PricingLine[];
  taxRatePercent: number;
  kept: KeptDiscounts;
}): PricedOrder {
  const { kept } = input;
  const subtotalP = input.lines.reduce((sum, l) => sum + toPence(l.quantity * l.unitPrice), 0);

  const tierPercent = kept.tier ? Math.min(100, Math.max(0, num(kept.tier.percent))) : 0;
  const tierDiscountP = Math.min(subtotalP, pct(subtotalP, tierPercent));

  let promoDiscountP = 0;
  const promo = kept.promotion;
  if (promo) {
    let raw: number;
    const rule = promo.rule;
    if (rule && rule.type === "percentage") {
      raw = pct(subtotalP, Math.min(100, Math.max(0, num(rule.value))));
    } else if (rule && rule.type === "fixed") {
      raw = toPence(Math.max(0, num(rule.value)));
    } else {
      raw = toPence(Math.max(0, num(promo.storedDiscount)));
    }
    const cap = rule && num(rule.maxDiscount) > 0 ? toPence(num(rule.maxDiscount)) : Infinity;
    promoDiscountP = Math.max(0, Math.min(raw, cap, subtotalP - tierDiscountP));
  }

  const netP = subtotalP - tierDiscountP - promoDiscountP;
  const vatRate = Math.max(0, num(input.taxRatePercent));
  const vatP = pct(netP, vatRate);
  const grossP = netP + vatP;

  const pointsDiscountP = toPence(Math.max(0, num(kept.pointsDiscount)));
  if (pointsDiscountP > grossP) {
    throw new PricingError(
      `The ${kept.pointsRedeemed} points already spent on this order are worth ${formatMoney(
        fromPence(pointsDiscountP),
      )}, more than the new ${formatMoney(fromPence(grossP))}. Keep enough on the order, or refund it instead.`,
      "POINTS_EXCEED_TOTAL",
    );
  }

  const totalP = grossP - pointsDiscountP;
  const total = fromPence(totalP);
  return {
    subtotal: fromPence(subtotalP),
    tier: kept.tier && tierPercent > 0 ? { ...kept.tier, percent: tierPercent } : null,
    tierDiscount: fromPence(tierDiscountP),
    promotion: promo ? { id: promo.id, code: promo.code, name: promo.name } : null,
    promoDiscount: fromPence(promoDiscountP),
    netAfterDiscounts: fromPence(netP),
    vatRate,
    vatAmount: fromPence(vatP),
    pointsRedeemed: pointsDiscountP > 0 ? kept.pointsRedeemed : 0,
    pointsDiscount: fromPence(pointsDiscountP),
    discountTotal: fromPence(tierDiscountP + promoDiscountP + pointsDiscountP),
    total,
    pointsEarned: pointsEarnedFor(total),
  };
}
