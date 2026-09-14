/**
 * The single "low stock" definition for Arcarna.
 *
 * A product is low stock when it is at or under its reorder point AND within
 * this percentage of that point — e.g. at 30%, a product with a par level of
 * 20 is "low" once it drops to 6 units or fewer (30% of 20, rounded).
 *
 * ARC-030: Control Centre (`server/services/controlCentre.ts`) and
 * `/api/inventory/alerts` (`server/routes/inventory.ts`) already agreed on
 * 30%; the Truths hub's inventory tab (`server/storage.ts`,
 * `getInventoryReports`) had its own independent 20% baked into the query,
 * so the same org could see two different "low stock" counts on two
 * different pages for the exact same stock. All three now import this one
 * constant instead of repeating the number.
 */
export const LOW_STOCK_THRESHOLD_PERCENT = 30;
