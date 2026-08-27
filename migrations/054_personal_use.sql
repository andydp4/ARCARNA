-- Staff taking stock for themselves had nowhere to go. It either went through
-- as a £0 sale, which quietly corrupted the sales figures and the commission
-- built on them, or it did not go through at all and the stock simply went
-- missing.
--
-- "Personal use" is a payment method, not a new kind of order: payment_method
-- is a free varchar with no check constraint, so nothing structural changes.
-- What changes is the handling — no sale, no commission, the stock deducted,
-- the cost booked as an expense that day, and every admin and manager told it
-- happened.
--
-- The reason is mandatory at the till. A Signal reading "personal use, £14.20"
-- gets ignored; one reading "staff lunch — 2 x sandwich" gets read, and being
-- read is the entire control.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS personal_use_reason text;
