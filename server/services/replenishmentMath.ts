/**
 * Pure replenishment arithmetic and line grouping, kept free of database
 * imports so it is unit-testable without a provisioned database.
 */

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
  const grossRequiredQty = Math.max(0, targetStock - input.stock);
  const requiredQty = Math.max(0, grossRequiredQty - Math.max(0, input.onOrderQty));
  return { targetStock, grossRequiredQty, requiredQty };
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
