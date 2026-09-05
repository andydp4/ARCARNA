-- One sale, several tenders. A £100 sale can be £50 cash and £50 on tick, or
-- £50 cash and £50 card, or any other combination — which the schema could not
-- say, because `orders.payment_method` holds exactly one value.
--
-- That single column forced a choice between two wrong answers on a split sale:
-- record it as all cash and the drawer never reconciles, or record it as all
-- tick and the business appears to be owed money it already has.
--
-- One row per tender leg. The legs sum to the order total; where an order has a
-- credit leg, `order_credit.amount_given` holds that leg's amount rather than
-- the whole sale — which is exactly why it was defined as a separate figure
-- from the total when the credit tables were added (migration 053).
--
-- `orders.payment_method` is kept and still written. For a single-tender sale
-- it is unchanged; for a split it reads 'split'. Every money figure now derives
-- from the legs, so the column is a label rather than a source of truth.
CREATE TABLE IF NOT EXISTS order_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method varchar(50) NOT NULL,
  amount numeric(12,2) NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_payments_amount_check') THEN
    -- Zero is allowed: a personal-use order is a real, recorded, zero-value
    -- leg. Negative is not — that is a refund, which has its own path.
    ALTER TABLE order_payments ADD CONSTRAINT order_payments_amount_check CHECK (amount >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS order_payments_order_idx ON order_payments (order_id);
CREATE INDEX IF NOT EXISTS order_payments_org_method_idx ON order_payments (org_id, method);

-- Backfill: every existing order had exactly one tender, so it becomes one leg
-- for its full total. This is not an assumption about history — it is history,
-- since there was no way to record anything else.
INSERT INTO order_payments (org_id, order_id, method, amount, created_at)
SELECT o.org_id, o.id, o.payment_method, o.total, COALESCE(o.created_at, now())
  FROM orders o
 WHERE o.org_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM order_payments p WHERE p.order_id = o.id);
