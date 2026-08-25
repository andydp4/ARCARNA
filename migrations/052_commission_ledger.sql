-- Commission used to be a single number per shift, stored on
-- cashier_shift_summaries and credited to that shift's one cashier. Two things
-- broke that:
--
--   * an order's pool now splits 90/10 between the cashier who completed it and
--     the cashier who loaded it, so one number cannot say who is owed what; and
--   * a sale on credit earns nothing until the customer pays, which can be
--     weeks after the shift that sold it closed — so commission and shift are
--     no longer the same event.
--
-- Numeric defaults are written as '0' rather than 0 so that a database built
-- by `drizzle-kit push` and one built by these migrations carry identical
-- column defaults — the migration integrity suite diffs the two.
--
-- One row per cashier per order per accrual. `basis` says which event produced
-- it: 'sale' for money taken at the till, 'credit_resolution' for a tick that
-- has since been paid.
--
-- order_margin, overhead_share, commission_rate and share_percent are SNAPSHOTS.
-- Changing a cashier's rate next month must not restate what they earned last
-- month, and the overhead share in particular cannot be recomputed later — it
-- belongs to the day the order was sold on, and that day's takings are closed.
CREATE TABLE IF NOT EXISTS cashier_commission_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  cashier_id uuid NOT NULL REFERENCES cashier_profiles(id),
  cashier_shift_id uuid REFERENCES cashier_shifts(id),
  role varchar(16) NOT NULL,
  basis varchar(24) NOT NULL,
  order_margin numeric(12,2) NOT NULL DEFAULT '0',
  overhead_share numeric(12,2) NOT NULL DEFAULT '0',
  commission_rate numeric(5,2) NOT NULL DEFAULT '0',
  share_percent numeric(5,2) NOT NULL DEFAULT '0',
  amount numeric(12,2) NOT NULL DEFAULT '0',
  accrued_on date NOT NULL,
  accrued_at timestamp NOT NULL DEFAULT now(),
  reversal_of uuid REFERENCES cashier_commission_entries(id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cashier_commission_entries_role_check') THEN
    ALTER TABLE cashier_commission_entries
      ADD CONSTRAINT cashier_commission_entries_role_check
      CHECK (role IN ('completer', 'inputter'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cashier_commission_entries_basis_check') THEN
    ALTER TABLE cashier_commission_entries
      ADD CONSTRAINT cashier_commission_entries_basis_check
      CHECK (basis IN ('sale', 'credit_resolution'));
  END IF;
END $$;

-- Payroll asks "what did this cashier earn between these dates?" on every run.
CREATE INDEX IF NOT EXISTS cashier_commission_entries_cashier_date_idx
  ON cashier_commission_entries (org_id, cashier_id, accrued_on);

-- The shift sheet sums its own entries when it closes.
CREATE INDEX IF NOT EXISTS cashier_commission_entries_shift_idx
  ON cashier_commission_entries (cashier_shift_id);

CREATE INDEX IF NOT EXISTS cashier_commission_entries_order_idx
  ON cashier_commission_entries (order_id);

-- Closing a shift twice, or replaying an offline order into a closed shift,
-- must not pay anybody twice. One accrual per cashier per role per order per
-- basis is the whole of the rule.
CREATE UNIQUE INDEX IF NOT EXISTS cashier_commission_entries_unique_accrual
  ON cashier_commission_entries (order_id, cashier_id, role, basis)
  WHERE reversal_of IS NULL;
