-- v1.2 Phase 4 review: a manager's edit is checked by the price guard too.
--
-- A manager who edits a line below the minimum or below cost after the sale
-- (PUT /api/orders/:id) makes an exception of their own: it gets its own
-- price_guard_orders row (source 'edit', user_id = the manager), its own
-- Needs a look row and its own Signal, which goes to admins and the owner.
-- The sale keeps one row (source 'sale'); each edit that makes a new breach
-- adds one.
-- Idempotent: re-applied on every deploy.
ALTER TABLE price_guard_orders ADD COLUMN IF NOT EXISTS source varchar(8) NOT NULL DEFAULT 'sale';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'price_guard_orders_source_check') THEN
    ALTER TABLE price_guard_orders
      ADD CONSTRAINT price_guard_orders_source_check CHECK (source IN ('sale', 'edit'));
  END IF;
END $$;

-- Was one row per order (migration 110); now one per sale.
DROP INDEX IF EXISTS price_guard_orders_order_uq;
CREATE UNIQUE INDEX IF NOT EXISTS price_guard_orders_sale_uq
  ON price_guard_orders (order_id) WHERE source = 'sale';
CREATE INDEX IF NOT EXISTS price_guard_orders_order_idx ON price_guard_orders (order_id);
