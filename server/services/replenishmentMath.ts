/**
 * Pure replenishment arithmetic and line grouping, kept free of database
 * imports so it is unit-testable without a provisioned database.
 */
import { roundQuantity } from "@shared/quantity";

/** Structurally compatible with `PurchaseDraftLineInput` in ./purchaseDrafts. */
export type GroupedPurchaseLine = {
  productId: string;
  quantity: number;
  estimatedCost?: string | number;
  supplierSku?: string;
};

export type PurchaseLineRequest = {
  supplierId: string;
  locationId: string;
  productId: string;
  quantity: number;
  estimatedCost?: string | number;
  supplierSku?: string;
  /** Recommendation snapshot this line came from, recorded as draft provenance. */
  recommendation?: unknown;
};

/**
 * Net quantity still needed to reach target coverage. Stock already on order
 * counts towards the target — without this a drafted order never clears its own
 * recommendation, so the same shortfall gets ordered again on the next visit.
 */
export function computeRequiredQty(input: {
  stock: number;
  velocityPerDay: number;
  targetCoverageDays: number;
  onOrderQty: number;
}) {
  const targetStock = Math.ceil(input.velocityPerDay * input.targetCoverageDays);
  // Subtracting decimal stock/on-order figures in float64 leaves noise like
  // 1.3499999999999996 (5 - 0.65 - 3) that later fails the 3-decimal-place
  // quantity validator when a purchase draft is raised from it. Rounding each
  // intermediate to the stored scale keeps both the API payload and the "Why?"
  // explanation the client renders from these fields clean.
  const grossRequiredQty = roundQuantity(Math.max(0, targetStock - input.stock));
  const requiredQty = roundQuantity(
    Math.max(0, grossRequiredQty - Math.max(0, input.onOrderQty)),
  );
  return { targetStock, grossRequiredQty, requiredQty };
}

/**
 * Turns a raw buy quantity into what actually gets written to a purchase
 * draft line: rounded to a whole unit, then up to the supplier's pack size.
 *
 * `buyQty` is a difference of decimal quantities (stock, on-order, internal
 * transfers), so float64 can leave it as e.g. 1.3499999999999996 — a value
 * `positiveQuantity` (shared/quantity.ts) rejects outright because it exceeds
 * 3 decimal places. Rounding off that noise first, then rounding *up* to the
 * next whole unit, guarantees a clean, storable quantity regardless of pack
 * size (a pack size of 1 previously returned the raw float unchanged).
 */
export function roundBuyQtyToPack(buyQty: number, packSize: number): number {
  if (buyQty <= 0) return 0;
  const wholeUnits = Math.ceil(roundQuantity(buyQty));
  if (packSize <= 1) return wholeUnits;
  return Math.ceil(wholeUnits / packSize) * packSize;
}

/**
 * Collapses per-product purchase lines into one draft per supplier+location.
 * Replenishment surfaces recommendations one product at a time, but a buyer
 * raises a single order per supplier — without grouping, approving a day's
 * recommendations produces a draft per line.
 */
export function groupPurchaseLinesBySupplier(lines: PurchaseLineRequest[]): {
  supplierId: string;
  locationId: string;
  items: GroupedPurchaseLine[];
  /** Only the recommendations behind this group's lines, so each draft records its own provenance. */
  recommendations: unknown[];
}[] {
  const groups = new Map<
    string,
    {
      supplierId: string;
      locationId: string;
      items: Map<string, GroupedPurchaseLine>;
      recommendations: unknown[];
    }
  >();

  for (const line of lines) {
    const key = `${line.supplierId}:${line.locationId}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        supplierId: line.supplierId,
        locationId: line.locationId,
        items: new Map(),
        recommendations: [],
      };
      groups.set(key, group);
    }

    if (line.recommendation !== undefined) {
      group.recommendations.push(line.recommendation);
    }

    const existing = group.items.get(line.productId);
    if (existing) {
      existing.quantity += line.quantity;
      existing.estimatedCost = existing.estimatedCost ?? line.estimatedCost;
      existing.supplierSku = existing.supplierSku ?? line.supplierSku;
    } else {
      group.items.set(line.productId, {
        productId: line.productId,
        quantity: line.quantity,
        estimatedCost: line.estimatedCost,
        supplierSku: line.supplierSku,
      });
    }
  }

  return Array.from(groups.values()).map((g) => ({
    supplierId: g.supplierId,
    locationId: g.locationId,
    items: Array.from(g.items.values()),
    recommendations: g.recommendations,
  }));
}
