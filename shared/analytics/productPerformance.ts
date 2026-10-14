export type ProductRankingMetric = "revenue" | "grossProfit" | "quantity";

export interface ProductPerformance {
  productId: string;
  name: string;
  quantity: number;
  revenue: number;
  /** Unknown when any remaining sale has no usable cost. Never assume £0. */
  grossProfit: number | null;
  missingCostUnits: number;
}

/** Rank the whole product set before applying a display limit. */
export function rankProducts<T extends ProductPerformance>(
  products: readonly T[], metric: ProductRankingMetric, limit: number,
): T[] {
  return products
    .filter((p) => metric !== "grossProfit" || p.grossProfit !== null)
    .sort((a, b) => (b[metric] ?? 0) - (a[metric] ?? 0)
      || a.name.localeCompare(b.name, "en-GB") || a.productId.localeCompare(b.productId))
    .slice(0, limit);
}
