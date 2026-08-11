-- Phase 2B: Set org_id NOT NULL on org-owned tables
-- Run AFTER: npm run backfill
-- FAILS HARD (aborts transaction) if any org_id is NULL

BEGIN;

-- Production migrations are applied in version order, so this file runs before
-- later backfill helpers. If a single-org database still carries legacy NULL
-- org_id rows, adopt them here before the hard pre-check so the NOT NULL
-- constraint lands in the same migration pass. Multi-org databases remain
-- deliberately blocked: guessing tenant ownership there would be worse than
-- refusing to apply the constraint.
DO $$
DECLARE
  org_count int;
  target_org uuid;
  adopted int;
  total int := 0;
  tbl text;
BEGIN
  SELECT count(*) INTO org_count FROM organizations;

  IF org_count = 1 THEN
    SELECT id INTO target_org FROM organizations LIMIT 1;

    FOREACH tbl IN ARRAY ARRAY[
      'products', 'customers', 'orders', 'order_items', 'order_expenses',
      'invoices', 'locations', 'loyalty_tiers', 'promotions',
      'overhead_expenses'
    ]
    LOOP
      IF to_regclass(tbl) IS NULL THEN
        CONTINUE;
      END IF;

      EXECUTE format('UPDATE %I SET org_id = $1 WHERE org_id IS NULL', tbl)
        USING target_org;
      GET DIAGNOSTICS adopted = ROW_COUNT;
      total := total + adopted;
    END LOOP;

    IF total > 0 THEN
      RAISE NOTICE '002: adopted % orphaned org_id row(s) before NOT NULL enforcement.', total;
    END IF;
  ELSIF org_count > 1 THEN
    RAISE NOTICE '002: % organizations present — refusing to guess orphaned org_id ownership.', org_count;
  END IF;
END $$;

-- Explicit pre-check: abort if any NULLs exist
DO $$
DECLARE
  n BIGINT;
  msg TEXT := '';
BEGIN
  SELECT COUNT(*) INTO n FROM products WHERE org_id IS NULL;
  IF n > 0 THEN msg := msg || 'products: ' || n || ' NULL; '; END IF;
  SELECT COUNT(*) INTO n FROM customers WHERE org_id IS NULL;
  IF n > 0 THEN msg := msg || 'customers: ' || n || ' NULL; '; END IF;
  SELECT COUNT(*) INTO n FROM orders WHERE org_id IS NULL;
  IF n > 0 THEN msg := msg || 'orders: ' || n || ' NULL; '; END IF;
  SELECT COUNT(*) INTO n FROM order_items WHERE org_id IS NULL;
  IF n > 0 THEN msg := msg || 'order_items: ' || n || ' NULL; '; END IF;
  SELECT COUNT(*) INTO n FROM order_expenses WHERE org_id IS NULL;
  IF n > 0 THEN msg := msg || 'order_expenses: ' || n || ' NULL; '; END IF;
  SELECT COUNT(*) INTO n FROM invoices WHERE org_id IS NULL;
  IF n > 0 THEN msg := msg || 'invoices: ' || n || ' NULL; '; END IF;
  SELECT COUNT(*) INTO n FROM locations WHERE org_id IS NULL;
  IF n > 0 THEN msg := msg || 'locations: ' || n || ' NULL; '; END IF;
  SELECT COUNT(*) INTO n FROM loyalty_tiers WHERE org_id IS NULL;
  IF n > 0 THEN msg := msg || 'loyalty_tiers: ' || n || ' NULL; '; END IF;
  SELECT COUNT(*) INTO n FROM promotions WHERE org_id IS NULL;
  IF n > 0 THEN msg := msg || 'promotions: ' || n || ' NULL; '; END IF;
  SELECT COUNT(*) INTO n FROM overhead_expenses WHERE org_id IS NULL;
  IF n > 0 THEN msg := msg || 'overhead_expenses: ' || n || ' NULL; '; END IF;
  IF msg != '' THEN
    RAISE EXCEPTION 'Cannot set NOT NULL: org_id NULLs remain. Run backfill first. %', msg;
  END IF;
END $$;

ALTER TABLE products ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE customers ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE orders ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE order_items ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE order_expenses ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE invoices ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE locations ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE loyalty_tiers ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE promotions ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE overhead_expenses ALTER COLUMN org_id SET NOT NULL;

COMMIT;
