-- Commission attaches to the person who logged in, not to a cashier code.
--
-- Cashier codes were a separate identity: `cashier_profiles` is a code, a
-- display name, a PIN and a rate, with no column joining it to `users` at all.
-- So the system could say "A1 sold this" but not "Priya sold this", and a
-- cashier had to pick their code from a dropdown before they could serve.
--
-- User ids are `varchar` here rather than uuid because that is what they are:
-- `users.id` is the auth subject, and `cashier_shifts.opened_by_user_id`
-- already stores it as varchar(255). No foreign key, for the same reason that
-- column has none — a user removed from the org must not make historic orders
-- unreadable.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS input_user_id varchar(255),
  ADD COLUMN IF NOT EXISTS completed_user_id varchar(255);

ALTER TABLE cashier_commission_entries
  ADD COLUMN IF NOT EXISTS user_id varchar(255);

ALTER TABLE cashier_shifts
  ADD COLUMN IF NOT EXISTS user_id varchar(255);

-- A shift belongs to a user now, so it must be able to exist without a code.
ALTER TABLE cashier_shifts ALTER COLUMN cashier_id DROP NOT NULL;

-- The per-user rate. Left null on purpose: the old per-code rates cannot be
-- mapped to users, because nothing ever linked the two. Everybody falls back to
-- the organisation default until somebody sets theirs in user management.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS commission_rate numeric(5,2);

-- Backfill. A shift records who opened it, so that is who was logged in while
-- it ran. This is an INFERENCE, not a record: it is the best evidence available
-- for orders taken before users were attributed, and it is exact for the normal
-- case of one person working their own shift.
UPDATE cashier_shifts
   SET user_id = opened_by_user_id
 WHERE user_id IS NULL
   AND opened_by_user_id IS NOT NULL;

UPDATE orders o
   SET input_user_id = s.user_id
  FROM cashier_shifts s
 WHERE o.input_user_id IS NULL
   AND s.user_id IS NOT NULL
   AND s.id = o.cashier_shift_id;

UPDATE orders o
   SET completed_user_id = s.user_id
  FROM cashier_shifts s
 WHERE o.completed_user_id IS NULL
   AND s.user_id IS NOT NULL
   AND s.id = o.completed_cashier_shift_id;

-- Commission entries follow their order, by the role each row holds.
UPDATE cashier_commission_entries e
   SET user_id = o.completed_user_id
  FROM orders o
 WHERE e.user_id IS NULL
   AND e.role = 'completer'
   AND o.id = e.order_id
   AND o.completed_user_id IS NOT NULL;

UPDATE cashier_commission_entries e
   SET user_id = o.input_user_id
  FROM orders o
 WHERE e.user_id IS NULL
   AND e.role = 'inputter'
   AND o.id = e.order_id
   AND o.input_user_id IS NOT NULL;

-- Payroll asks "what did this person earn between these dates?" every run.
CREATE INDEX IF NOT EXISTS cashier_commission_entries_user_date_idx
  ON cashier_commission_entries (org_id, user_id, accrued_on);

CREATE INDEX IF NOT EXISTS orders_completed_user_idx
  ON orders (org_id, completed_user_id);

CREATE INDEX IF NOT EXISTS cashier_shifts_user_idx
  ON cashier_shifts (org_id, user_id);

-- Shift summaries follow the same rule: they belong to a user, and a shift with
-- no cashier code must still be able to produce one.
ALTER TABLE cashier_shift_summaries
  ADD COLUMN IF NOT EXISTS user_id varchar(255);

ALTER TABLE cashier_shift_summaries ALTER COLUMN cashier_id DROP NOT NULL;

UPDATE cashier_shift_summaries s
   SET user_id = sh.user_id
  FROM cashier_shifts sh
 WHERE s.user_id IS NULL
   AND sh.user_id IS NOT NULL
   AND sh.id = s.shift_id;

CREATE INDEX IF NOT EXISTS cashier_shift_summaries_user_idx
  ON cashier_shift_summaries (org_id, user_id);
