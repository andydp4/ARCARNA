export type StockTurnStatus = "healthy" | "watch" | "slow";

export type StockTurnCategoryRow = {
  category: string;
  unitsSold: number;
  avgStock: number;
  dailySalesRate: number;
  daysOfStock: number;
  turnRate: number;
  status: StockTurnStatus;
};

/** Category from SKU/product_id prefix before first `-` or `_`, else General. */
export function productCategoryFromSku(productId: string): string {
  const id = (productId ?? "").trim();
  if (!id) return "General";
  const sep = id.search(/[-_]/);
  const prefix = sep > 0 ? id.slice(0, sep) : id;
  const label = prefix.trim();
  if (!label) return "General";
  return label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
}

export function classifyDaysOfStock(days: number): StockTurnStatus {
  if (!Number.isFinite(days) || days <= 0) return "healthy";
  if (days > 90) return "slow";
  if (days >= 30) return "watch";
  return "healthy";
}

export function computeCategoryStockTurn(input: {
  category: string;
  unitsSold: number;
  avgStock: number;
  windowDays: number;
}): StockTurnCategoryRow {
  const { category, unitsSold, avgStock, windowDays } = input;
  const safeWindow = Math.max(1, windowDays);
  const dailySalesRate = unitsSold / safeWindow;
  const turnRate =
    avgStock > 0 ? Math.round((unitsSold / avgStock) * 100) / 100 : unitsSold > 0 ? unitsSold : 0;
  const daysOfStock =
    dailySalesRate > 0
      ? Math.round((avgStock / dailySalesRate) * 10) / 10
      : avgStock > 0
        ? 999
        : 0;

  return {
    category,
    unitsSold,
    avgStock: Math.round(avgStock * 10) / 10,
    dailySalesRate: Math.round(dailySalesRate * 100) / 100,
    daysOfStock,
    turnRate,
    status: classifyDaysOfStock(daysOfStock),
  };
}

export function aggregateStockTurnByCategory(
  products: Array<{ productId: string; unitsSold: number; avgStock: number }>,
  windowDays: number,
): StockTurnCategoryRow[] {
  const byCat = new Map<string, { unitsSold: number; avgStock: number }>();

  for (const p of products) {
    const cat = productCategoryFromSku(p.productId);
    const cur = byCat.get(cat) ?? { unitsSold: 0, avgStock: 0 };
    cur.unitsSold += p.unitsSold;
    cur.avgStock += p.avgStock;
    byCat.set(cat, cur);
  }

  return [...byCat.entries()]
    .map(([category, agg]) =>
      computeCategoryStockTurn({
        category,
        unitsSold: agg.unitsSold,
        avgStock: agg.avgStock,
        windowDays,
      }),
    )
    .sort((a, b) => b.daysOfStock - a.daysOfStock);
}
