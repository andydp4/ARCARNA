-- A manager can move an open order from Walk-in to a named customer, or from
-- the wrong person to the right one. The timeline records who it was and who
-- it is now. Idempotent: the check is only replaced when it does not already
-- name this kind.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'order_events_kind_check'
      AND pg_get_constraintdef(oid) LIKE '%''customer_reassigned''%'
  ) THEN
    ALTER TABLE order_events DROP CONSTRAINT IF EXISTS order_events_kind_check;
    ALTER TABLE order_events ADD CONSTRAINT order_events_kind_check CHECK (kind IN
     ('received','assigned','unassigned','ready','unready','arrived','out_for_delivery','held','unheld',
      'delayed','delay_cleared','due_set','completed','reopened','status_changed','deleted','edited',
      'customer_reassigned'));
  END IF;
END $$;
