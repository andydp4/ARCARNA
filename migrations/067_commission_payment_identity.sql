-- ARC-004: "Confirm paid" can never succeed for a lazily-opened shift.
--
-- cashier_commission_payments.cashier_id was NOT NULL, so recording a payment
-- required a cashier profile. Migration 057/058 removed the requirement for a
-- shift to have one at all: the first sale of the day opens a shift keyed on
-- the user, with cashier_id left null. That shift's commission accrues fine
-- (cashier_commission_entries went through the same fix in migration 061),
-- but nothing could ever record it as paid — the payment insert had a column
-- with nowhere to put the missing code and nothing else to name the payee.
--
-- This mirrors 061 exactly, on the payments table instead of the entries
-- table: cashier_id becomes optional, user_id is added alongside it, and a
-- check constraint keeps at least one of the two present so a payment can
-- never be recorded for nobody.

-- 1. A code is no longer required to receive a payment.
ALTER TABLE cashier_commission_payments
  ALTER COLUMN cashier_id DROP NOT NULL;

-- 2. `user_id` names the payee when there is no code (varchar(255) with no
--    foreign key — same reasoning as everywhere else user ids are stored
--    since migration 057: removing somebody from the org must not make a
--    historic payment record unreadable).
ALTER TABLE cashier_commission_payments
  ADD COLUMN IF NOT EXISTS user_id varchar(255);

CREATE INDEX IF NOT EXISTS cashier_commission_payments_user_id_idx
  ON cashier_commission_payments (user_id);

-- 3. Somebody has to be named. A payment identifying nobody would be money
--    that no report could ever attribute — this only has to catch a
--    regression, since the route always resolves one or the other before
--    inserting.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cashier_commission_payments_party_check'
  ) THEN
    ALTER TABLE cashier_commission_payments
      ADD CONSTRAINT cashier_commission_payments_party_check
      CHECK (cashier_id IS NOT NULL OR user_id IS NOT NULL);
  END IF;
END $$;
