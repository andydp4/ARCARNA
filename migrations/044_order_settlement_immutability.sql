-- Security: freeze post-payment order financials.
--
-- `settled_total` is the order total at the moment it FIRST reached
-- "completed" — i.e. what was actually collected. Refunds cap against this
-- instead of `orders.total`, so editing line prices after payment can no
-- longer inflate the refundable amount (cash / store credit payout).
--
-- Additive and idempotent.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS settled_total numeric(10,2),
  ADD COLUMN IF NOT EXISTS settled_at timestamp;

-- Backfill: existing completed orders settle at their current total. This is
-- the best available evidence of what was collected for historic rows, and it
-- freezes them from this point forward.
UPDATE orders
   SET settled_total = total,
       settled_at    = COALESCE(updated_at, created_at, now())
 WHERE status = 'completed'
   AND settled_total IS NULL;
