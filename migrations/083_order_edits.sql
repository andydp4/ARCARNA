-- v1.2 Phase 1B: manager edits and the paths that create orders.
--
-- 1. An "edited" order event. A manager's edit re-prices the order and
--    rewrites its payment record; the event carries the lines and money before
--    and after, so every change to what a customer was charged has a record.
-- 2. The website's default status can no longer be "completed". An order born
--    completed skipped settlement (settled total, credit leg, commission);
--    settings that chose it go back to "pending".
-- Idempotent: re-applied on every deploy. Each constraint is only replaced
-- when it does not already say what it should, so a deploy does not
-- re-validate the table every time.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'order_events_kind_check'
      AND pg_get_constraintdef(oid) LIKE '%''edited''%'
  ) THEN
    ALTER TABLE order_events DROP CONSTRAINT IF EXISTS order_events_kind_check;
    ALTER TABLE order_events ADD CONSTRAINT order_events_kind_check CHECK (kind IN
     ('received','assigned','unassigned','ready','unready','arrived','out_for_delivery','held','unheld',
      'delayed','delay_cleared','due_set','completed','reopened','status_changed','deleted','edited'));
  END IF;
END $$;

UPDATE website_order_settings SET default_order_status = 'pending' WHERE default_order_status = 'completed';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'website_order_settings_status_ck'
      AND pg_get_constraintdef(oid) NOT LIKE '%''completed''%'
  ) THEN
    ALTER TABLE website_order_settings DROP CONSTRAINT IF EXISTS website_order_settings_status_ck;
    ALTER TABLE website_order_settings ADD CONSTRAINT website_order_settings_status_ck
      CHECK (default_order_status IN ('pending', 'on-hold', 'awaiting-customer', 'urgent'));
  END IF;
END $$;
