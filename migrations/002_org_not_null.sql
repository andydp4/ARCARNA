-- Phase 2B: Set org_id NOT NULL on org-owned tables
-- Self-heals safe single-org orphan rows before enforcing the constraint.
-- FAILS HARD (aborts transaction) if any org_id is NULL

BEGIN;

-- Adopt orphaned tenant-owned rows when there is exactly one possible owner.
-- This must live in 002 itself: later migrations run too late to unblock this
-- pre-check, so a 048-style backfill can only help on the next deploy.
DO $$
DECLARE
  org_count int;
  target_org uuid;
  adopted int;
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
      EXECUTE format('UPDATE %I SET org_id = $1 WHERE org_id IS NULL', tbl)
        USING target_org;
      GET DIAGNOSTICS adopted = ROW_COUNT;
      IF adopted > 0 THEN
        RAISE NOTICE '002: adopted % orphaned row(s) in % into org % before NOT NULL', adopted, tbl, target_org;
      END IF;
    END LOOP;
  ELSIF org_count > 1 THEN
    RAISE NOTICE '002: % organizations present - refusing to guess an owner. Any orphaned rows will abort NOT NULL enforcement.', org_count;
  ELSE
    RAISE NOTICE '002: no organizations — orphan adoption skipped.';
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
