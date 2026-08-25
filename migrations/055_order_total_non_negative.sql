-- Nothing stopped an order totalling less than zero. The Zod schema put no
-- lower bound on `total`, the column had no check, and the route added no
-- guard — so a negative order would post straight through and pay out as
-- negative takings, which is a refund by another name and with none of a
-- refund's controls.
--
-- Deliberately `>= 0` and not `> 0`: personal use (migration 054) is a real,
-- recorded, zero-total order.
--
-- A below-cost sale is untouched by this. Its total is positive; only its
-- margin is negative, so clearing dead stock still works and simply earns no
-- commission.
--
-- Fails loudly if any row already violates it rather than quietly skipping the
-- constraint. If this stops a deploy, the rows need fixing first — a guard
-- that silently did not apply would be worse than no guard.
DO $$
DECLARE
  offending bigint;
BEGIN
  SELECT count(*) INTO offending FROM orders WHERE total < 0;
  IF offending > 0 THEN
    RAISE EXCEPTION
      'Cannot add orders_total_non_negative: % order(s) already total less than zero. Correct them first.',
      offending;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_total_non_negative') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_total_non_negative CHECK (total >= 0);
  END IF;
END $$;
