-- v1.2 Phase 2 (PRC-06): order-line snapshots.
--
-- Each line keeps the list price, the floor (the minimum as it applied —
-- never cost; the full floor is the higher of this and unit_cost) and the
-- unit cost as they were when it was sold, so a cost edited today cannot
-- rewrite last week's margin and the discount given becomes measurable.
-- NULL unit_cost means the cost was not known at the time.
--
-- There is deliberately NO backfill: a made-up snapshot would be wrong for
-- every line sold before a price or cost change. Lines with list_price NULL
-- were sold before snapshots existed; readers cost them at today's cost
-- (shared/pricing/lineSnapshot.ts, lineUnitCost).
-- Idempotent: re-applied on every deploy.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS list_price numeric(10,2);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS floor_price numeric(10,2);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS unit_cost numeric(10,2);
