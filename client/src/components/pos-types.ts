/**
 * How this order reached the till (brief, "Form embedding": Walk-in / Phone /
 * WhatsApp chips on the payment step). `web` and `api` are website/API
 * origins the till itself never sends — they exist only so the till's
 * channel type lines up with `packages/domain/src/schemas.ts`'s enum.
 */
export type PosChannel = "pos" | "phone" | "whatsapp" | "web" | "api";

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
