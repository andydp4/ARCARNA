import { usableCost } from "@shared/purchasing/purchaseLines";
import { storedMinPrice } from "@shared/pricing/floor";

/**
 * The products table's Min and Margin % columns (v1.2 Phase 4, PRC-05).
 * Min: the stored minimum, or "Follows price" when none is set (it then
 * follows the sale price). Margin %: on the sale price, only where cost is
 * known — never from a £0 or blank cost. Margin % is shown to managers and
 * above only (the page checks canSeeCost; cashiers never receive cost).
 */
export function minPriceLabel(minPrice: unknown): string {
  const min = storedMinPrice(minPrice as string | number | null | undefined);
  return min == null ? "Follows price" : `£${min.toFixed(2)}`;
}

export function marginPercent(salePrice: unknown, costPrice: unknown): number | null {
  const sale = Number(salePrice);
  const cost = usableCost((costPrice as string | number | null | undefined) ?? null);
  if (cost == null || !Number.isFinite(sale) || sale <= 0) return null;
  return ((sale - cost) / sale) * 100;
}

export function marginPercentLabel(salePrice: unknown, costPrice: unknown): string {
  const m = marginPercent(salePrice, costPrice);
  return m == null ? "—" : `${m.toFixed(1)}%`;
}
