import { usableCost } from "../purchasing/purchaseLines";
import { effectiveFloor, type FloorProduct } from "./floor";

/**
 * Order-line snapshots and silent underpricing checks (v1.2 Phase 2: PRC-06,
 * PRC-03, CMP-03).
 *
 * Each order line keeps the list price, the floor and the unit cost as they
 * were when it was sold. Without them a cost edited today rewrites last week's
 * margin, and a discount cannot be measured because the list price it was
 * taken from has moved. There is no backfill: a line sold before this change
 * has no snapshot, and readers fall back to the product's cost today for it
 * (the only figure there ever was), see {@link lineUnitCost}.
 */

type Money = string | number | null | undefined;

export type LineSnapshot = {
  /** The product's sale price when the line was sold. */
  listPrice: number;
  /**
   * The minimum as it applied (the stored minimum, or the sale price when it
   * follows it) — never cost. The full floor is max(floorPrice, unitCost), so
   * both halves of the rule survive separately and the till's minimum-only
   * floor (owner Q4) can be read back without it.
   */
  floorPrice: number;
  /** Known cost (usableCost rule: £0 or blank is unknown), or null. */
  unitCost: number | null;
};

function toPence(n: number): number {
  return Math.round(n * 100);
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function money(value: Money): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The snapshot for one product, through effectiveFloor() — the one reader of
 * the floor. Null when the product has no usable sale price (a line for a
 * product that no longer exists): no snapshot beats a made-up one.
 */
export function snapshotFor(product: FloorProduct | null | undefined): LineSnapshot | null {
  if (!product) return null;
  const sale = money(product.defaultSalePrice ?? product.salePrice);
  if (sale == null || sale < 0) return null;
  const f = effectiveFloor(product, { includeCost: true });
  return {
    listPrice: roundMoney(sale),
    floorPrice: roundMoney(f.minimum),
    unitCost: f.cost == null ? null : roundMoney(f.cost),
  };
}

export type UnderpricedCheck = {
  belowMinimum: boolean;
  belowCost: boolean;
  /** £ below the list price across the line's quantity (never negative). */
  underList: number;
  /** £ below known cost across the line's quantity; 0 when not below cost. */
  underCost: number;
};

/**
 * Whether a line sold below its minimum or below known cost (owner Q3: every
 * such sale, no allowance, no trade exemption). Compared in pence so a price
 * keyed as 4.5 is not "below" a stored 4.50. Null when the line is fine or
 * has no snapshot to judge it against.
 *
 * `netLineTotal` is what the line actually brought in once the order's own
 * discounts (tier, promotion, points) are shared out over it, see
 * {@link netLineTotals}. Without it the line's own unit price is judged: a
 * 30% trade tier leaves every unit price at list, so judging only that would
 * miss a sale made below cost by the tier (Q3: no trade exemption).
 */
export function underpricedLine(
  line: { quantity: number; unitPrice: number; netLineTotal?: number | null },
  snap: LineSnapshot | null | undefined,
): UnderpricedCheck | null {
  if (!snap) return null;
  const qty = Number(line.quantity) || 0;
  if (qty <= 0) return null;
  // Whole-line pence, so a discount shared out as 1000p over 3 units is not
  // rounded per unit into or out of a breach.
  const net =
    line.netLineTotal != null && Number.isFinite(Number(line.netLineTotal))
      ? toPence(Number(line.netLineTotal))
      : toPence(line.unitPrice) * qty;
  const at = (unit: number) => toPence(unit) * qty;
  const belowMinimum = net < at(snap.floorPrice);
  const belowCost = snap.unitCost != null && net < at(snap.unitCost);
  if (!belowMinimum && !belowCost) return null;
  return {
    belowMinimum,
    belowCost,
    underList: roundMoney(Math.max(0, at(snap.listPrice) - net) / 100),
    underCost: belowCost ? roundMoney((at(snap.unitCost!) - net) / 100) : 0,
  };
}

/** The order-level discounts behind a priced order (priceOrder's result). */
export type OrderDiscounts = {
  subtotal: number;
  /** Subtotal less tier and promotion, before VAT. */
  netAfterDiscounts: number;
  /** Points come off after VAT (owner Q2). */
  pointsDiscount?: number | null;
  vatRate?: number | null;
};

/**
 * Each line's share of what the order actually brought in before VAT: the
 * tier and promotion (taken off the subtotal) and the points (taken off after
 * VAT, so brought back to a pre-VAT figure) shared out over the lines by
 * value. Prices, minimums and costs are all VAT exclusive, so this is the
 * figure a floor is judged against. Largest remainder in pence, so the shares
 * add up to the order exactly. Without discounts each line keeps its own total.
 */
export function netLineTotals(
  lines: Array<{ quantity: number; unitPrice: number }>,
  pricing: OrderDiscounts | null | undefined,
): number[] {
  const gross = lines.map((l) => Math.max(0, toPence((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0))));
  const subtotalP = gross.reduce((a, b) => a + b, 0);
  if (!pricing || subtotalP <= 0) return gross.map((p) => p / 100);
  const vat = Math.max(0, Number(pricing.vatRate) || 0);
  const pointsPreVatP = toPence(Math.max(0, Number(pricing.pointsDiscount) || 0) / (1 + vat / 100));
  const netP = Math.max(0, Math.min(subtotalP, toPence(Number(pricing.netAfterDiscounts) || 0) - pointsPreVatP));
  if (netP >= subtotalP) return gross.map((p) => p / 100);
  const exact = gross.map((p) => (p * netP) / subtotalP);
  const shares = exact.map(Math.floor);
  let left = netP - shares.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, r: x - Math.floor(x) }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    shares[i] += 1;
    left -= 1;
  }
  return shares.map((p) => p / 100);
}

/**
 * Sales the silent check does not look at.
 *  - Website orders price at list; the customer cannot change a price, so
 *    there is nothing to catch (brief). That is known only from the server's
 *    own website checkout passing `pricedAtList` — never from the order's
 *    `channel`, which any till or API caller can set to "web". A manager's
 *    later edit of a website order is not exempt: that is a person choosing a
 *    price.
 *  - Personal use is not a sale: its total is zeroed and the stock is booked
 *    at cost as an expense, so every line would read as "below cost".
 */
export function isPriceCheckExempt(order: {
  paymentMethod?: string | null;
  source: "sale" | "edit";
  /** Set by the server's website checkout only, never from a request body. */
  pricedAtList?: boolean;
}): boolean {
  if (String(order.paymentMethod ?? "").toLowerCase() === "personal_use") return true;
  return order.source === "sale" && order.pricedAtList === true;
}

/**
 * The unit cost a report should use for a line: the snapshot when the line
 * has one (list price set marks a snapshotted line, even when its cost was
 * unknown at the time — that stays unknown rather than picking up a cost
 * entered later), otherwise the product's cost today for lines sold before
 * snapshots existed. Both through the usableCost rule.
 */
export function lineUnitCost(
  line: { listPrice?: Money; unitCost?: Money },
  productCostToday: Money,
): number | null {
  if (money(line.listPrice) != null) return usableCost(line.unitCost ?? null);
  return usableCost(productCostToday ?? null);
}

export type CommissionCostBasis = {
  /** Cost of the lines whose cost is known. */
  stockCost: number;
  /** Share (0–1) of the order's line value whose cost is known. */
  knownShare: number;
  /** Lines left out of commission because their cost is unknown. */
  costMissingLines: number;
};

/**
 * Commission leaves out a line with no known cost (owner Q5, "cost missing"):
 * counting it at £0 cost paid commission on its whole price as if it were pure
 * profit. The line's revenue leaves with it — as its share of the order's line
 * value, because what was collected (after discounts and VAT) is only known
 * for the order as a whole.
 */
export function commissionCostBasis(
  items: Array<{ quantity: number; lineTotal: number; unitCost: number | null }>,
): CommissionCostBasis {
  let stockCost = 0;
  let known = 0;
  let all = 0;
  let costMissingLines = 0;
  for (const item of items) {
    const value = Math.max(0, Number(item.lineTotal) || 0);
    all += value;
    if (item.unitCost == null) {
      costMissingLines += 1;
      continue;
    }
    known += value;
    stockCost += (Number(item.quantity) || 0) * item.unitCost;
  }
  // No line value to apportion by (all lines at £0): known lines keep the
  // order in, one unknown line with nothing known takes it out.
  const knownShare = all > 0 ? known / all : costMissingLines > 0 && costMissingLines === items.length ? 0 : 1;
  return { stockCost: roundMoney(stockCost), knownShare, costMissingLines };
}
