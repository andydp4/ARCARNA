-- v1.2 Phase 1A: the till's sale reference (client_order_id).
--
-- The till makes a reference when a sale starts and sends it on every attempt:
-- the first try, a retry after a timeout, and an offline replay. Unique per
-- organisation, so a repeat finds the order that already landed instead of
-- recording the sale a second time. NULL for orders that do not come from the
-- till (web, API), which the partial index leaves alone.
-- Idempotent: re-applied on every deploy.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_order_id varchar(64);

CREATE UNIQUE INDEX IF NOT EXISTS orders_org_client_order_id_uq
  ON orders (org_id, client_order_id)
  WHERE client_order_id IS NOT NULL;
