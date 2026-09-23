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
 */
export function underpricedLine(
  line: { quantity: number; unitPrice: number },
  snap: LineSnapshot | null | undefined,
): UnderpricedCheck | null {
  if (!snap) return null;
  const price = toPence(line.unitPrice);
  const belowMinimum = price < toPence(snap.floorPrice);
  const belowCost = snap.unitCost != null && price < toPence(snap.unitCost);
  if (!belowMinimum && !belowCost) return null;
  const qty = Number(line.quantity) || 0;
  return {
    belowMinimum,
    belowCost,
    underList: roundMoney((Math.max(0, toPence(snap.listPrice) - price) * qty) / 100),
    underCost: belowCost ? roundMoney(((toPence(snap.unitCost!) - price) * qty) / 100) : 0,
  };
}

/**
 * Sales the silent check does not look at.
 *  - Website orders price at list; the customer cannot change a price, so
 *    there is nothing to catch (brief). A manager's later edit of one is not
 *    exempt: that is a person choosing a price.
 *  - Personal use is not a sale: its total is zeroed and the stock is booked
 *    at cost as an expense, so every line would read as "below cost".
 */
export function isPriceCheckExempt(order: {
  channel?: string | null;
  paymentMethod?: string | null;
  source: "sale" | "edit";
}): boolean {
  if (String(order.paymentMethod ?? "").toLowerCase() === "personal_use") return true;
  return order.source === "sale" && order.channel === "web";
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
