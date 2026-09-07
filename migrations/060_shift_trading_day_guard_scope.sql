-- Migration 058 could not create cashier_shifts_user_trading_day_idx on a
-- database with trading history. It failed on the first production deploy:
--
--   ERROR: could not create unique index "cashier_shifts_user_trading_day_idx"
--   DETAIL: Key (org_id, user_id, trading_day)=(..., 2026-08-23) is duplicated.
--
-- The data is not wrong. Under the old model a shift was a login session
-- opened by hand, and opening two in a day — a break, a till swap, an
-- accidental double-open — was ordinary and legal. 057 backfilled user_id from
-- opened_by_user_id and 058 backfilled trading_day from opened_at, so those
-- historic sessions now collide on a key that never applied to them.
--
-- Rewriting them is the wrong fix. 058's own backfill computes trading_day at
-- UTC precisely so that already-closed, already-reported days do not move, and
-- merging or deleting historic shifts would move takings between shifts that
-- have been reported and paid on. Historic duplicates also cost the new code
-- nothing: resolveShiftForToday only ever looks at the trading day in
-- progress, and every report reads a shift at a time.
--
-- So the index keeps its meaning and narrows its scope to the rows the
-- invariant was written for. cashier_id is the line between the two models,
-- and it is exact rather than convenient:
--
--   * Before 057, cashier_shifts.cashier_id was NOT NULL — every historic
--     shift carries a code.
--   * openCashierShift(), the manual-open path that set it, lost its last
--     caller in L2 and creates nothing now.
--   * resolveShiftForToday() is the only live path that creates a shift, and
--     it never sets a code.
--
-- So "cashier_id IS NULL" is precisely "opened lazily on first sale, under the
-- model this index defends" — but it is not the whole scope. It must also stay
-- OPEN-only, matching shared/schema.ts's own definition of this index, which
-- this file failed to mirror when first written:
--
--   If somebody closes a same-day lazy shift and keeps selling, the next
--   sale must open a fresh open shift rather than attaching to a closed one.
--
-- Without that "status = 'open'" condition, a shift auto-closed mid-day
-- (inactivity, or a backdated order settling the moment it lands) becomes a
-- PERMANENT occupant of this key: no second row for that (org, user, day) can
-- ever be created again, open or closed, which is the opposite of the
-- "unique index -> loud failure on a real bug" contract this migration exists
-- to provide. It surfaced on the first production database with any
-- already-closed lazily-opened shifts: every subsequent backdated catch-up
-- entry for an already-settled day opened a fresh shift (finding no OPEN one
-- to reuse) and closed it again seconds later, fragmenting that day's
-- commission and report across one shift per order — silently, until this
-- index tried to enforce uniqueness across ALL of them at once and failed.
DROP INDEX IF EXISTS cashier_shifts_user_trading_day_idx;

CREATE UNIQUE INDEX IF NOT EXISTS cashier_shifts_user_trading_day_idx
  ON cashier_shifts (org_id, user_id, trading_day)
  WHERE user_id IS NOT NULL
    AND trading_day IS NOT NULL
    AND cashier_id IS NULL
    AND status = 'open';

-- Fail loudly rather than leave the guard off. Nothing under the new model can
-- violate this, so a violation here means a duplicate was created after the
-- cutover and needs a person: without the index, two concurrent first sales
-- both open a shift and split somebody's day — and their commission — in two.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'cashier_shifts_user_trading_day_idx'
  ) THEN
    RAISE EXCEPTION
      'cashier_shifts_user_trading_day_idx was not created. Duplicate lazily-opened OPEN shifts exist; resolve them before deploying.';
  END IF;
END $$;
