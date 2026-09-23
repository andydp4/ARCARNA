import { usableCost } from "./purchaseLines";

/**
 * Supplier price against the cost on the product card (v1.2 Phase 3, Stock
 * Centre › Suppliers). The two drift apart when a supplier changes a price and
 * nobody updates the card, and every margin figure in arcarna is worked out
 * from the card — so a gap here is a margin that is quietly wrong.
 */

/** Flag when the two differ by MORE than this, as a percentage of the card cost. */
export const SUPPLIER_COST_TOLERANCE_PERCENT = 2;

export type SupplierCostStatus =
  | "match"
  | "differs"
  | "missing-supplier"
  | "missing-card"
  | "missing-both";

export interface SupplierCostCheck {
  status: SupplierCostStatus;
  /** True for anything a manager should look at: a gap over tolerance, or either price missing. */
  flagged: boolean;
  supplierCost: number | null;
  cardCost: number | null;
  /** Supplier minus card, as a percentage of the card cost, 1 dp. Null when either is missing. */
  diffPercent: number | null;
}

/**
 * Zero and blanks count as missing (`usableCost`): a product saved without a
 * cost stores "0", which means "nobody entered one", not "free".
 */
export function checkSupplierCost(
  supplierCostRaw: string | number | null | undefined,
  cardCostRaw: string | number | null | undefined,
): SupplierCostCheck {
  const supplierCost = usableCost(supplierCostRaw);
  const cardCost = usableCost(cardCostRaw);
  if (supplierCost == null || cardCost == null) {
    const status: SupplierCostStatus =
      supplierCost == null && cardCost == null
        ? "missing-both"
        : supplierCost == null
          ? "missing-supplier"
          : "missing-card";
    return { status, flagged: true, supplierCost, cardCost, diffPercent: null };
  }
  // Pence, not floats: 0.1 + 0.2 must not tip a 2.00% gap over the line.
  const supplierPence = Math.round(supplierCost * 100);
  const cardPence = Math.round(cardCost * 100);
  const diffPercent = Math.round(((supplierPence - cardPence) / cardPence) * 1000) / 10;
  // Compared on the exact ratio, not the rounded display figure.
  const over = Math.abs(supplierPence - cardPence) * 100 > SUPPLIER_COST_TOLERANCE_PERCENT * cardPence;
  return {
    status: over ? "differs" : "match",
    flagged: over,
    supplierCost,
    cardCost,
    diffPercent,
  };
}
