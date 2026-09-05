-- Cashier commission is about to be split between two people: the cashier who
-- loaded the order and the cashier who completed it (90/10). The orders table
-- could not express that — it carried a single `cashier_id` / `cashier_shift_id`
-- pair, which answered "whose shift was this order on?" but not "who did which
-- half of the work?"
--
-- Three columns, all nullable, all additive:
--   input_cashier_id            — who created the order. NULL for web and
--                                 storefront orders, which have no inputter;
--                                 that absence is what makes the completer take
--                                 100% of the pool rather than 90%.
--   completed_cashier_id        — who took it to "completed".
--   completed_cashier_shift_id  — the shift that was open when they did.
--
-- The completing pair is written ONCE, at the first transition to "completed",
-- alongside `settled_total` / `settled_at` (migration 044) and for the same
-- reason: reopening an order and re-completing it under a different cashier
-- must not move commission that has already accrued.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS input_cashier_id uuid REFERENCES cashier_profiles(id),
  ADD COLUMN IF NOT EXISTS completed_cashier_id uuid REFERENCES cashier_profiles(id),
  ADD COLUMN IF NOT EXISTS completed_cashier_shift_id uuid REFERENCES cashier_shifts(id);

-- Backfill: every existing order was loaded and completed by the same person,
-- because there was no way to record anything else. Writing the same cashier
-- into both columns is not an assumption about history — it is history. It also
-- means historic shift summaries decompose to exactly the figures they already
-- hold, with one cashier taking 100% of each pool.
UPDATE orders
   SET input_cashier_id = cashier_id
 WHERE cashier_id IS NOT NULL
   AND input_cashier_id IS NULL;

-- Only completed orders get a completing cashier. A pending order has not been
-- completed by anyone yet, and inventing a completer for it would attribute
-- commission for work that has not happened.
UPDATE orders
   SET completed_cashier_id = cashier_id,
       completed_cashier_shift_id = cashier_shift_id
 WHERE status = 'completed'
   AND cashier_id IS NOT NULL
   AND completed_cashier_id IS NULL;

-- The commission ledger reads "every order this cashier completed in a date
-- range" on every payroll and analytics call.
CREATE INDEX IF NOT EXISTS orders_completed_cashier_idx
  ON orders (org_id, completed_cashier_id);

-- The shift balance sheet loads a shift's orders by the shift that COMPLETED
-- them, falling back to the shift that created them for orders still open.
CREATE INDEX IF NOT EXISTS orders_completed_cashier_shift_idx
  ON orders (completed_cashier_shift_id);
