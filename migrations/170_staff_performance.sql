-- v1.2 Phase 7A/7B: Order Timing by person and Staff Performance.
-- Re-applied on every deploy, so every statement is idempotent.

-- 1. The station each person was on when they acted on a board card (7A).
--    Until now only the CURRENT station was known (ops_staff.station), so a
--    comparison between stations would have re-labelled last month's work
--    with today's rota. Stamped by a trigger rather than by each writer:
--    order_events are written from the board, completion, reopen, edits,
--    deletes and the v1 API, and a column one of them forgets is a
--    comparison that quietly drifts. 'all' means the person had no station
--    set (the board's "All"); NULL means nobody signed in did it, or the
--    person has never opened the board.
ALTER TABLE order_events ADD COLUMN IF NOT EXISTS station varchar(16);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_events_station_check') THEN
    ALTER TABLE order_events
      ADD CONSTRAINT order_events_station_check
      CHECK (station IS NULL OR station IN ('collection', 'delivery', 'both', 'all'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION order_events_stamp_station() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.station IS NULL AND NEW.user_id IS NOT NULL THEN
    SELECT coalesce(s.station, 'all') INTO NEW.station
      FROM ops_staff s
     WHERE s.org_id = NEW.org_id AND s.user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS order_events_station_trg ON order_events;
CREATE TRIGGER order_events_station_trg
  BEFORE INSERT ON order_events
  FOR EACH ROW EXECUTE FUNCTION order_events_stamp_station();

-- 2. When per-person figures started (7A/7B). The owner checks the team
--    figures first, so every per-person view says "provisional" for the
--    first two weeks after this date. Existing orgs start the day this
--    migration runs; a new org starts when it is created.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS staff_performance_since timestamp NOT NULL DEFAULT now();
