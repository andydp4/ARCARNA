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

CREATE UNIQUE INDEX IF NOT EXISTS cashier_shifts_user_trading_day_idx
  ON cashier_shifts (org_id, user_id, trading_day)
  WHERE user_id IS NOT NULL AND trading_day IS NOT NULL;

CREATE INDEX IF NOT EXISTS cashier_shifts_trading_day_idx
  ON cashier_shifts (org_id, trading_day);
