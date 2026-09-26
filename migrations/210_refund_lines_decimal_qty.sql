-- v1.2.1 e2e (E2E-05): a line sold by weight is refunded by weight.
--
-- order_items.quantity is numeric(14,3) (weighed lines such as 0.5 kg), but
-- refund_lines.qty was an integer, so a 0.5 line could never be refunded:
-- 0.5 was refused as not a whole number and 1 as more than was sold. The
-- refund quantity now has the same three places as the line it refunds.
--
-- Idempotent: re-applied on every deploy. Changing a column to the type it
-- already has is a no-op, and existing whole-number rows convert exactly.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'refund_lines' AND column_name = 'qty' AND data_type <> 'numeric'
  ) THEN
    ALTER TABLE refund_lines ALTER COLUMN qty TYPE numeric(14,3) USING qty::numeric(14,3);
  END IF;
END $$;
