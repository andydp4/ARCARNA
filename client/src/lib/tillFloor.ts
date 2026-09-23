import { tillFloor, type FloorProduct } from "@shared/pricing/floor";

/**
 * The till's floor for a product (PRC-01, owner Q4): the minimum only, never
 * cost. The server sends it as `tillFloor` on every product read and the till
 * caches the list offline, so it is there with no connection; a row cached
 * before the field existed falls back to the same shared rule. Not shown yet —
 * Phase 4 shows the lowest allowed price.
 */
export function tillFloorOf(product: (FloorProduct & { tillFloor?: unknown }) | null | undefined): number | null {
  if (!product) return null;
  const sent = typeof product.tillFloor === "number" ? product.tillFloor : Number(product.tillFloor);
  if (product.tillFloor != null && Number.isFinite(sent)) return sent;
  return tillFloor(product);
}
