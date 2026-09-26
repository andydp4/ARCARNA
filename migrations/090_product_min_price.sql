-- v1.2 Phase 2 (PRC-01): the minimum price.
--
-- NULL means "follows the sale price" and is the default for every product.
-- There is deliberately NO backfill: a copied figure would go stale the first
-- time the price changed, and a backfill re-applied on every deploy would put
-- back minimums that managers had cleared.
-- Read only through effectiveFloor() in shared/pricing/floor.ts.
-- Idempotent: re-applied on every deploy.
ALTER TABLE products ADD COLUMN IF NOT EXISTS min_price numeric(10,2);
