-- Credit (tick) had no state of its own. An unpaid tick was inferred from the
-- order still being "pending", and "mark paid" simply set it to "completed" —
-- so the question "has this been paid?" was answered by a column that means
-- "have the goods gone?".
--
-- That conflation is fatal to the new model, in which a tick order IS completed
-- on the day the goods leave (the sale happened, revenue is recognised) and is
-- merely unpaid. Under the old test every tick sale would read as paid the
-- moment it completed, and would pay commission on day one against money nobody
-- had received.
--
-- Two tables. `order_credit` is the outstanding balance, one row per order.
-- `credit_payments` is every payment made against it — several are normal, and
-- they can be of different kinds, because a customer settling an account pays
-- some cash and some card.
CREATE TABLE IF NOT EXISTS order_credit (
  order_id uuid PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id),
  -- What was put on credit. Deliberately separate from the order total: it is
  -- the portion of the sale that went on tick, which is the whole of it today
  -- and need not be if a sale is ever split across tenders at the counter.
  amount_given numeric(12,2) NOT NULL DEFAULT '0',
  amount_outstanding numeric(12,2) NOT NULL DEFAULT '0',
  status varchar(16) NOT NULL DEFAULT 'outstanding',
  given_on date NOT NULL,
  settled_on date,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL,
  -- How it was paid. Required, not optional: a cash settlement and a card
  -- settlement land differently in the drawer, and the Z-report cannot
  -- reconcile a shift without knowing which of the two arrived.
  method varchar(50) NOT NULL DEFAULT 'cash',
  paid_on date NOT NULL,
  recorded_by_user_id uuid,
  note text,
  created_at timestamp NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_credit_status_check') THEN
    ALTER TABLE order_credit ADD CONSTRAINT order_credit_status_check
      CHECK (status IN ('outstanding', 'partial', 'settled', 'written_off', 'voided'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_payments_amount_check') THEN
    ALTER TABLE credit_payments ADD CONSTRAINT credit_payments_amount_check
      CHECK (amount > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS order_credit_org_status_idx ON order_credit (org_id, status);
CREATE INDEX IF NOT EXISTS order_credit_customer_idx ON order_credit (customer_id);
CREATE INDEX IF NOT EXISTS credit_payments_order_idx ON credit_payments (order_id);
CREATE INDEX IF NOT EXISTS credit_payments_org_date_idx ON credit_payments (org_id, paid_on);

-- Backfill. Under the old scheme a tick order that was still "pending" was
-- unpaid and one that was "completed" had been marked paid, so that is exactly
-- how they are carried over. No payment rows are invented for the settled ones:
-- nobody recorded when or how they were paid, and fabricating a date would put
-- commission on a day the money did not arrive.
INSERT INTO order_credit (order_id, org_id, customer_id, amount_given, amount_outstanding, status, given_on, settled_on)
SELECT o.id,
       o.org_id,
       o.customer_id,
       o.total,
       CASE WHEN o.status = 'completed' THEN 0 ELSE o.total END,
       CASE WHEN o.status = 'completed' THEN 'settled' ELSE 'outstanding' END,
       COALESCE(o.created_at::date, CURRENT_DATE),
       CASE WHEN o.status = 'completed' THEN COALESCE(o.updated_at::date, o.created_at::date) END
  FROM orders o
 WHERE LOWER(o.payment_method) = 'tick'
   AND NOT EXISTS (SELECT 1 FROM order_credit c WHERE c.order_id = o.id);

-- The commission ledger's idempotency guard was written for accrual at shift
-- close, where one order pays each cashier once. A credit sale settled in
-- instalments accrues repeatedly — once per payment — so the guard has to move
-- from "one row per order per cashier per role" to "one row per PAYMENT per
-- cashier per role". Sale accruals keep the original rule.
ALTER TABLE cashier_commission_entries
  ADD COLUMN IF NOT EXISTS credit_payment_id uuid REFERENCES credit_payments(id) ON DELETE CASCADE;

DROP INDEX IF EXISTS cashier_commission_entries_unique_accrual;

CREATE UNIQUE INDEX IF NOT EXISTS cashier_commission_entries_unique_sale
  ON cashier_commission_entries (order_id, cashier_id, role)
  WHERE basis = 'sale' AND reversal_of IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cashier_commission_entries_unique_resolution
  ON cashier_commission_entries (credit_payment_id, cashier_id, role)
  WHERE basis = 'credit_resolution' AND reversal_of IS NULL;
