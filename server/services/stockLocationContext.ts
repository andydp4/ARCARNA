import { StockError, resolveStockLocationId } from "./productLocationStock";

export type EditableStockLocationContext = {
  orgId: string;
  locationId?: string | null;
  userId?: string | null;
};

/**
 * Resolve the concrete location used by editable stock views.
 *
 * Product and inventory list endpoints feed forms that PATCH absolute stock
 * values. If they show org-wide totals while the write path resolves a single
 * default/first location, saving the unchanged-looking number corrupts that
 * location's stock. Return null only when the org has no stock location yet.
 */
export async function resolveEditableStockLocationId(
  ctx: EditableStockLocationContext,
): Promise<string | null> {
  try {
    return await resolveStockLocationId({
      orgId: ctx.orgId,
      locationId: ctx.locationId,
      userId: ctx.userId,
    });
  } catch (error) {
    if (error instanceof StockError && error.code === "LOCATION_UNRESOLVED") {
      return null;
    }
    throw error;
  }
}
