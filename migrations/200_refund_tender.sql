-- v1.2.1 money: refunds go back the way the money came in.
--
-- credit_amount: the part of a refund taken off the customer's tab (Credit
-- List) instead of being paid out. A refunded tab sale used to be paid out in
-- cash while the tab stayed outstanding. Only total - credit_amount leaves the
-- till.
--
-- refund_method gains "card" (back to the card, not out of the drawer) and
-- "credit" (nothing paid out; all of it came off the tab). Databases built
-- from migration 025 carry a CHECK that allowed only the first three.
--
-- Idempotent: re-applied on every deploy.
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS credit_amount numeric(10, 2) NOT NULL DEFAULT '0';

ALTER TABLE refunds DROP CONSTRAINT IF EXISTS refunds_refund_method_check;
ALTER TABLE refunds ADD CONSTRAINT refunds_refund_method_check
  CHECK (refund_method IN ('original', 'cash', 'card', 'store_credit', 'credit'));
