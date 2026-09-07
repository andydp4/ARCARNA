/** The shape the till works with: what /api/products returns, stock at the active location. */
export interface PosProduct {
  id: string;
  name: string;
  productId: string;
  defaultSalePrice: string | number;
  stock: number;
  stockLimit: number;
  barcode?: string | null;
}

export function posPrice(product: PosProduct): number {
  const raw = product.defaultSalePrice;
  const n = typeof raw === "string" ? parseFloat(raw) : raw;
  return Number.isFinite(n) ? Number(n) : 0;
}

export function formatPosPrice(product: PosProduct): string {
  return `£${posPrice(product).toFixed(2)}`;
}
