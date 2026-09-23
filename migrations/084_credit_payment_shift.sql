-- v1.2 Phase 1C: cash taken against a tab belongs to a drawer.
--
-- A cash repayment on the Credit List went into the till but was never part of
-- the till's expected cash, so every drawer that took one counted "over". The
-- payment is now stamped with the recorder's open till shift, and that shift's
-- expected cash includes the cash ones, on their own Z-report line.
--
-- shifts.tab_cash_in_expected marks a shift whose stored expected cash was
-- worked out under that rule. Shifts closed before it keep false, so their
-- Z-reports can say that tab repayments were not included; nothing already
-- counted is rewritten.
-- Payments recorded before this release have no shift: which drawer they went
-- into was never recorded, and guessing would move old variances.
-- Idempotent: re-applied on every deploy.
ALTER TABLE credit_payments ADD COLUMN IF NOT EXISTS shift_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'credit_payments_shift_id_shifts_id_fk'
  ) THEN
    ALTER TABLE credit_payments
      ADD CONSTRAINT credit_payments_shift_id_shifts_id_fk
      FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS credit_payments_shift_idx ON credit_payments (shift_id);

ALTER TABLE shifts ADD COLUMN IF NOT EXISTS tab_cash_in_expected boolean NOT NULL DEFAULT false;
