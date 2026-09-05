-- A shift is one person's trading day, not a login session.
--
-- Opening one by hand is gone: a shift now exists per user per trading day,
-- runs 06:00 to 06:00 in the organisation's own timezone, and survives logging
-- out. Going for lunch and coming back returns you to the same shift; only the
-- 06:00 cut ends it.
--
-- The unique index is what makes "open it if it isn't there" safe. Two tills
-- taking the same person's first sale of the day at the same moment both try to
-- open a shift; one wins, the other finds it. Without this they would both
-- succeed and the day's takings would be split across two shifts.
ALTER TABLE cashier_shifts
  ADD COLUMN IF NOT EXISTS trading_day date;

-- Backfill from when each shift opened. Historic shifts were opened by hand at
-- the start of a session, so the day they opened on is the day they traded.
-- Computed at UTC+0 deliberately: it is what the old figures were built on, and
-- recomputing history in local time would silently move orders between days
-- that have already been closed and reported.
UPDATE cashier_shifts
   SET trading_day = (opened_at AT TIME ZONE 'UTC')::date
 WHERE trading_day IS NULL;

-- Skipped where the old model left duplicates. Migration 060 narrows this index
-- to shifts with no cashier code and is what actually holds on a database with
-- history; this unscoped version only ever applies to a fresh one.
--
-- Without the guard the CREATE below fails on every deploy of a database that
-- has any duplicate (org, user, trading day) group — which is ordinary historic
-- data, since a shift used to be a login session and two in a day was normal.
-- That failure is harmless in itself, because 060 creates the correct index
-- moments later. It stopped being harmless when the runner started treating a
-- migration error as a failed deploy: it took the app down on the very deploy
-- that was meant to fix it. Every file here re-runs on every deploy, so an
-- applied migration has to stay re-runnable — the same rule 052 carries.
DO $$
DECLARE
  duplicate_groups bigint;
BEGIN
  SELECT count(*) INTO duplicate_groups FROM (
    SELECT 1
      FROM cashier_shifts
     WHERE user_id IS NOT NULL AND trading_day IS NOT NULL
     GROUP BY org_id, user_id, trading_day
    HAVING count(*) > 1
  ) d;

  IF duplicate_groups > 0 THEN
    RAISE NOTICE
      '058: % duplicate (org, user, trading day) group(s) predate the new model. Leaving this index to 060, which scopes it to codeless shifts.',
      duplicate_groups;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS cashier_shifts_user_trading_day_idx
      ON cashier_shifts (org_id, user_id, trading_day)
      WHERE user_id IS NOT NULL AND trading_day IS NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS cashier_shifts_trading_day_idx
  ON cashier_shifts (org_id, trading_day);
