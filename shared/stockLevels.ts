import { LOW_STOCK_THRESHOLD_PERCENT } from "./constants/stock";

/**
 * The read-only "Stock levels" view in the Stock Centre (v1.2 Phase 3): what a
 * cashier needs to answer "have we got any?" and nothing else.
 *
 * Built as an allow-list, not by stripping fields: a new column on `products`
 * (a cost, a margin, a supplier) never reaches this view by accident.
 */
export type StockLevelStatus = "out" | "low" | "ok";

export interface StockLevelRow {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  stock: number;
  stockLimit: number;
  status: StockLevelStatus;
}

/** Same "low" rule as the alerts and the Control Centre (shared/constants/stock.ts). */
export function stockLevelStatus(stock: number, stockLimit: number): StockLevelStatus {
  if (stock <= 0) return "out";
  if (stockLimit > 0 && stock <= stockLimit && (stock / stockLimit) * 100 <= LOW_STOCK_THRESHOLD_PERCENT) {
    return "low";
  }
  return "ok";
}

export function toStockLevelRow(product: {
  id: string;
  name: string;
  productId: string;
  barcode?: string | null;
  stock?: number | string | null;
  stockLimit?: number | string | null;
}): StockLevelRow {
  const stock = Number(product.stock ?? 0) || 0;
  const stockLimit = Number(product.stockLimit ?? 0) || 0;
  return {
    id: product.id,
    name: product.name,
    sku: product.productId,
    barcode: product.barcode ?? null,
    stock,
    stockLimit,
    status: stockLevelStatus(stock, stockLimit),
  };
}
