/**
 * A manager's edit of an order's lines and prices (v1.2 Phase 1B, "Manager
 * edits").
 *
 * An edit changes what the customer is charged, so it follows the same rules
 * as the sale did:
 *  - priced by priceEditedOrder() at the org's VAT rate, keeping the sale's
 *    tier %, promotion and points (the edit used to drop every discount and,
 *    until Sept 2026, add 20% VAT at a shop that charges none);
 *  - the payment record is rewritten to the new total, in the same
 *    transaction, so the tick amount that joins the Credit List on completion
 *    is what the customer now owes;
 *  - an "edited" order event records the lines and money before and after.
 *
 * Refused, never half-done:
 *  - an order paid in several parts (split tender, or a gift card and
 *    something else): which part should move is a re-tender, and there is no
 *    re-tender flow yet;
 *  - personal use, which is not a sale;
 *  - an order already on the Credit List;
 *  - an order taken before discounts were recorded that shows money taken
 *    off: the edit cannot know what to keep;
 *  - points already spent that would be worth more than the new total.
 */
import { and, eq } from "drizzle-orm";
import { orderCredit, orderPayments, promotions } from "@shared/schema";
import {
  PricingError,
  priceEditedOrder,
  type KeptDiscounts,
  type PricedOrder,
  type PricingLine,
} from "@shared/pricing/priceOrder";

type Tx = any;

export type OrderEditRefusalCode =
  | "ORDER_SETTLED_IMMUTABLE"
  | "ORDER_EDIT_MULTI_PART"
  | "ORDER_EDIT_PERSONAL_USE"
  | "ORDER_EDIT_ON_CREDIT_LIST"
  | "ORDER_EDIT_LEGACY_DISCOUNT"
  | "ORDER_EDIT_POINTS_EXCEED_TOTAL";

/** The route answers 409: the order's state, not the request, is the problem. */
export class OrderEditRefusedError extends Error {
  readonly statusCode = 409;
  constructor(
    message: string,
    readonly code: OrderEditRefusalCode,
  ) {
    super(message);
    this.name = "OrderEditRefusedError";
  }
}

/** The order row as apps/server/src/db/schema.ts returns it (snake_case). */
export type EditableOrderRow = {
  id: string;
  org_id: string | null;
  status: string | null;
  total: string;
  payment_method: string;
  subtotal: string | null;
  tier_discount: string | null;
  tier_discount_percent: string | null;
  promotion_id: string | null;
  promo_code: string | null;
  promo_discount: string | null;
  points_redeemed: number | null;
  points_discount: string | null;
  vat_rate: string | null;
  vat_amount: string | null;
};

export type OrderLineRow = {
  product_id: string;
  quantity: number | string;
  unit_price: string | null;
  total_price: string | null;
};

export type PaymentLeg = { id?: string; method: string; amount: string | number };

/** What the "edited" event records on each side. */
export type OrderMoneySnapshot = {
  lines: Array<{ productId: string; quantity: number; unitPrice: number; lineTotal: number }>;
  subtotal: number | null;
  tierDiscount: number | null;
  promoDiscount: number | null;
  pointsDiscount: number | null;
  vatRate: number | null;
  vatAmount: number | null;
  total: number;
  payments: Array<{ method: string; amount: number }>;
};

function money(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(n: number): number {
  return Math.round(Number((n * 100).toPrecision(12))) / 100;
}

export function snapshotOrderMoney(
  row: EditableOrderRow,
  lines: OrderLineRow[],
  legs: PaymentLeg[],
): OrderMoneySnapshot {
  return {
    lines: lines.map((l) => ({
      productId: l.product_id,
      quantity: Number(l.quantity),
      unitPrice: money(l.unit_price) ?? 0,
      lineTotal: money(l.total_price) ?? 0,
    })),
    subtotal: money(row.subtotal),
    tierDiscount: money(row.tier_discount),
    promoDiscount: money(row.promo_discount),
    pointsDiscount: money(row.points_discount),
    vatRate: money(row.vat_rate),
    vatAmount: money(row.vat_amount),
    total: money(row.total) ?? 0,
    payments: legs.map((l) => ({ method: l.method, amount: money(l.amount) ?? 0 })),
  };
}

/** Methods whose leg moved a balance somewhere else (a gift card's). */
function isGiftCardMethod(method: string): boolean {
  return method.toLowerCase().includes("gift_card");
}

/**
 * Why this order cannot be edited, or null. Pure, so the dialog's preview and
 * the save give the same answer.
 */
export function orderEditRefusal(
  row: EditableOrderRow,
  lines: OrderLineRow[],
  legs: PaymentLeg[],
  creditStatus: string | null,
): OrderEditRefusedError | null {
  if (row.status === "completed") {
    return new OrderEditRefusedError(
      "This order is already completed. Its items and prices are locked. Refund or reopen the order instead.",
      "ORDER_SETTLED_IMMUTABLE",
    );
  }
  const method = String(row.payment_method ?? "").toLowerCase();
  if (method === "personal_use") {
    return new OrderEditRefusedError(
      "Personal use is not a sale, so it has no prices to edit. Delete it and record it again.",
      "ORDER_EDIT_PERSONAL_USE",
    );
  }
  const methods = new Set(legs.map((l) => l.method.toLowerCase()));
  if (legs.length > 1 || method === "split" || isGiftCardMethod(method) || [...methods].some(isGiftCardMethod)) {
    return new OrderEditRefusedError(
      "This order was paid in more than one part, so an edit cannot tell which payment should change. Refund it and ring it up again.",
      "ORDER_EDIT_MULTI_PART",
    );
  }
  if (creditStatus && creditStatus !== "voided") {
    return new OrderEditRefusedError(
      "This order is on the Credit List. Settle or void the credit before changing the order.",
      "ORDER_EDIT_ON_CREDIT_LIST",
    );
  }
  if (row.subtotal === null || row.subtotal === undefined) {
    // Before migration 082 the breakdown was not recorded. Points used to be
    // taken off the total afterwards; if the total is below its lines, the
    // edit cannot know what was taken off or why, and would silently drop it.
    const linesTotal = round2(lines.reduce((s, l) => s + (money(l.total_price) ?? 0), 0));
    const total = money(row.total) ?? 0;
    if (total < linesTotal - 0.005) {
      return new OrderEditRefusedError(
        "This order was taken before discounts were recorded, and money was taken off it. Refund it and ring it up again rather than lose the discount.",
        "ORDER_EDIT_LEGACY_DISCOUNT",
      );
    }
  }
  return null;
}

/** The sale's own discounts, to be kept by the edit. */
export async function keptDiscountsFor(tx: Tx, row: EditableOrderRow): Promise<KeptDiscounts> {
  const tierPercent = money(row.tier_discount_percent) ?? 0;
  let promotion: KeptDiscounts["promotion"] = null;
  const storedPromo = money(row.promo_discount) ?? 0;
  if (row.promotion_id || storedPromo > 0) {
    let rule: NonNullable<KeptDiscounts["promotion"]>["rule"] = null;
    let name = row.promo_code ?? "Promotion";
    if (row.promotion_id && row.org_id) {
      const [promo] = await tx
        .select({ name: promotions.name, type: promotions.type, value: promotions.value, maxDiscount: promotions.maxDiscount })
        .from(promotions)
        .where(and(eq(promotions.id, row.promotion_id), eq(promotions.orgId, row.org_id)))
        .limit(1);
      if (promo) {
        name = promo.name;
        rule = { type: promo.type, value: promo.value, maxDiscount: promo.maxDiscount };
      }
    }
    promotion = { id: row.promotion_id, code: row.promo_code, name, rule, storedDiscount: storedPromo };
  }
  return {
    tier: tierPercent > 0 ? { id: null, name: "Loyalty tier", percent: tierPercent } : null,
    promotion,
    pointsRedeemed: row.points_redeemed ?? 0,
    pointsDiscount: money(row.points_discount) ?? 0,
  };
}

/** Prices the new lines, turning a pricing refusal into an edit refusal. */
export function priceEditOrRefuse(input: { lines: PricingLine[]; taxRatePercent: number; kept: KeptDiscounts }): PricedOrder {
  try {
    return priceEditedOrder(input);
  } catch (error) {
    if (error instanceof PricingError) {
      throw new OrderEditRefusedError(error.message, "ORDER_EDIT_POINTS_EXCEED_TOTAL");
    }
    throw error;
  }
}

/** Everything the edit decides from, read on the caller's client. */
export async function loadOrderEditState(
  tx: Tx,
  row: EditableOrderRow,
  lines: OrderLineRow[],
): Promise<{ legs: PaymentLeg[]; creditStatus: string | null; refusal: OrderEditRefusedError | null }> {
  const legs: PaymentLeg[] = await tx
    .select({ id: orderPayments.id, method: orderPayments.method, amount: orderPayments.amount })
    .from(orderPayments)
    .where(eq(orderPayments.orderId, row.id));
  const [credit] = await tx
    .select({ status: orderCredit.status })
    .from(orderCredit)
    .where(eq(orderCredit.orderId, row.id))
    .limit(1);
  const creditStatus = credit?.status ?? null;
  return { legs, creditStatus, refusal: orderEditRefusal(row, lines, legs, creditStatus) };
}

/**
 * The payment record follows the new total. Only ever one leg here (several
 * are refused above). An order from before legs were written has none; the
 * credit leg then falls back to the order's own total, which the edit has
 * already moved.
 */
export async function rewritePaymentRecordTx(tx: Tx, legs: PaymentLeg[], total: number): Promise<PaymentLeg[]> {
  if (legs.length !== 1 || !legs[0].id) return legs;
  const amount = round2(total).toFixed(2);
  await tx.update(orderPayments).set({ amount }).where(eq(orderPayments.id, legs[0].id));
  return [{ ...legs[0], amount }];
}
