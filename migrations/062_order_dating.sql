-- Orders dated for a day other than the one they were keyed in on.
--
-- A day's sales that never got entered, and pre-orders taken for a date still
-- to come, both need `created_at` to be the day the sale is FOR — that column is
-- what every report, the daily close and the shift engine already read as the
-- moment of sale, so setting it puts the order on the right day everywhere at
-- once. What must not be lost is that the order was NOT keyed in then:
--
--   entered_at  when it was actually keyed in. Historic rows are left NULL,
--               which reads as "entered live, as far as anyone knows".
--   date_kind   live | backdated | preorder — so the exceptions can be listed
--               without comparing two timestamps by eye.
--
-- The window (7 days back, 14 ahead) is enforced in code, not here: it is a
-- policy, and a check constraint would refuse the historic rows that predate it.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS entered_at timestamp DEFAULT now();

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS date_kind varchar(16) NOT NULL DEFAULT 'live';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_date_kind_check'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_date_kind_check
      CHECK (date_kind IN ('live', 'backdated', 'preorder'));
  END IF;
END $$;

-- The exceptions are the rows anyone goes looking for; live sales are never
-- queried by this column.
CREATE INDEX IF NOT EXISTS orders_dated_idx
  ON orders (org_id, date_kind, created_at)
  WHERE date_kind <> 'live';
