-- The live invariant is one OPEN lazy shift per user/trading day. Closed
-- shifts are history: resolving a sale must not attach to one, and a cashier
-- who closes a shift then keeps selling needs a fresh open row rather than a
-- closed row that will never accrue commission again.
DROP INDEX IF EXISTS cashier_shifts_user_trading_day_idx;

CREATE UNIQUE INDEX IF NOT EXISTS cashier_shifts_user_trading_day_idx
  ON cashier_shifts (org_id, user_id, trading_day)
  WHERE user_id IS NOT NULL
    AND trading_day IS NOT NULL
    AND cashier_id IS NULL
    AND status = 'open';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'cashier_shifts_user_trading_day_idx'
  ) THEN
    RAISE EXCEPTION
      'cashier_shifts_user_trading_day_idx was not created. Duplicate open lazy shifts exist; resolve them before deploying.';
  END IF;
END $$;
