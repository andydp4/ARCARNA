-- v1.2.1 e2e (E2E-07): a new sale counts the units of the same product that
-- were sold but not yet taken off stock by the InventoryWorker, so two tills
-- selling the last unit at once cannot both have it. That reads order_items
-- by product, which had no index.
--
-- Idempotent: re-applied on every deploy.
CREATE INDEX IF NOT EXISTS order_items_product_id_idx ON order_items (product_id);
