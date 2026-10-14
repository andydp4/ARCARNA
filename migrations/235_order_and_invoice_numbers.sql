-- Shop order numbers and the invoice number floor (arcarna 1.3).
--
-- New orders take the next number from 440400001. New invoices take the next
-- number from 440000001. Rows already stored keep the numbers they have:
-- orders.order_number stays NULL, and invoices.sequence_number /
-- invoice_number are not rewritten.
--
-- Counters only move forward. A last-number that is already ahead of the
-- floor, or ahead of the stored counter, is left where it is or caught up.
-- Idempotent.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_number integer;

CREATE UNIQUE INDEX IF NOT EXISTS orders_org_order_number_uq
  ON orders (org_id, order_number)
  WHERE order_number IS NOT NULL;

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS order_last_number integer;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS order_start_number integer DEFAULT 440400001;

ALTER TABLE organizations ALTER COLUMN invoice_start_number SET DEFAULT 440000001;
ALTER TABLE organizations ALTER COLUMN order_start_number SET DEFAULT 440400001;

UPDATE organizations
SET invoice_start_number = 440000001
WHERE invoice_start_number IS NULL OR invoice_start_number < 440000001;

UPDATE organizations o
SET invoice_last_number = sub.max_seq
FROM (
  SELECT org_id, MAX(sequence_number) AS max_seq
  FROM invoices
  WHERE sequence_number IS NOT NULL
  GROUP BY org_id
) sub
WHERE o.id = sub.org_id
  AND (o.invoice_last_number IS NULL OR o.invoice_last_number < sub.max_seq);

UPDATE organizations o
SET order_last_number = sub.max_n
FROM (
  SELECT org_id, MAX(order_number) AS max_n
  FROM orders
  WHERE order_number IS NOT NULL
  GROUP BY org_id
) sub
WHERE o.id = sub.org_id
  AND (o.order_last_number IS NULL OR o.order_last_number < sub.max_n);
