import { roundQuantity } from "../quantity";

/**
 * A cost is only usable if it is a real, positive amount. `products.cost_price`
 * is written as "0" whenever a product is created without one (repos.ts
 * `String(costPrice || 0)`), so zero means "nobody entered a cost", not "free".
 */
export function usableCost(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export type PurchaseUnitCostSource = "line" | "supplier" | "product";

/**
 * The unit cost a purchase line should carry, most specific first: a cost typed
 * on the line itself, then the supplier's price on the product↔supplier link,
 * then the cost price on the product card.
 *
 * Before this existed a draft took its cost ONLY from the supplier link. A
 * product with a cost on its card but none on the link produced a purchase
 * order of "—" per line and an estimated total of £0.00.
 */
export function resolvePurchaseUnitCost(input: {
  lineCost?: string | number | null;
  supplierCost?: string | number | null;
  productCost?: string | number | null;
}): { unitCost: number | null; source: PurchaseUnitCostSource | null } {
  const line = usableCost(input.lineCost);
  if (line != null) return { unitCost: line, source: "line" };
  const supplier = usableCost(input.supplierCost);
  if (supplier != null) return { unitCost: supplier, source: "supplier" };
  const product = usableCost(input.productCost);
  if (product != null) return { unitCost: product, source: "product" };
  return { unitCost: null, source: null };
}

/**
 * Statuses in which a line's quantity and cost can still be changed.
 *
 * `approved` is included only while nothing has been booked against the draft:
 * a manager who approves and then realises they need 10,000 rather than the
 * recommended 3,864 must be able to correct it without cancelling and
 * re-raising the whole order. Once any receipt exists (pending or completed)
 * the ordered figures are what the delivery is being checked against, so they
 * lock — an over-delivery is then accepted at receiving instead.
 */
export function canEditPurchaseLines(status: string, activeReceiptCount: number): boolean {
  if (status === "draft" || status === "reviewed") return true;
  if (status === "approved") return activeReceiptCount === 0;
  return false;
}

/**
 * How much of a requested receipt quantity exceeds what is still outstanding on
 * the purchase line. Zero when the delivery fits within the order.
 */
export function overDeliveryExcess(input: {
  ordered: number;
  alreadyReceived: number;
  pendingOnOtherReceipts: number;
  requested: number;
}): number {
  const remaining = Math.max(
    0,
    roundQuantity(input.ordered - input.alreadyReceived - input.pendingOnOtherReceipts),
  );
  return Math.max(0, roundQuantity(input.requested - remaining));
}
