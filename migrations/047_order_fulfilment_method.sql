-- Orders had no way to say how the customer takes the goods. `channel` records
-- how the order arrived (pos, whatsapp, ...) and was the closest thing
-- available, but the two are independent: a WhatsApp order can be collected and
-- a counter sale can be delivered, so `channel` could never answer "how many are
-- waiting to go out on a round?" The Control Centre needs that split, and there
-- was nothing in the schema to build it from.
--
-- "collection" is the default and the backfill value. Every order that exists
-- today was taken at the till or arranged ad hoc and handed over — none of them
-- went through a delivery flow, because there wasn't one. Defaulting to
-- "delivery" would retroactively invent a delivery history that never happened.
--
-- Constrained to the two values the UI offers rather than left free-text: this
-- column drives operational counts, and a typo'd third value would silently
-- vanish from both totals rather than showing up as an obvious wrong number.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS fulfilment_method varchar(16) NOT NULL DEFAULT 'collection';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_fulfilment_method_check'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_fulfilment_method_check
      CHECK (fulfilment_method IN ('collection', 'delivery'));
  END IF;
END $$;

-- Open orders are filtered by fulfilment on the Control Centre, and that runs on
-- every dashboard load. Partial index: completed orders are the bulk of the
-- table and are never counted by those tiles.
CREATE INDEX IF NOT EXISTS idx_orders_fulfilment_open
  ON orders (org_id, fulfilment_method)
  WHERE status <> 'completed';
