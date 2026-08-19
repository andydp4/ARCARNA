-- Adopt rows that belong to no tenant, so 002_org_not_null.sql can finally apply.
--
-- Production carries four invoices with org_id IS NULL. A row with no org is
-- invisible to every org-scoped query: absent from the Invoices page, from
-- reports, and from every revenue total, while still existing as a financial
-- record. 002 has been refusing to set its NOT NULL constraint because of them
-- and rolling back on every single deploy — working exactly as intended, and
-- never actioned, because clearing it needed someone to run `npm run backfill`
-- by hand.
--
-- This does the same adoption as scripts/backfill-org.ts, but as part of the
-- normal migration run, so it happens on deploy instead of waiting for someone
-- to remember.
--
-- STRICTLY GUARDED TO SINGLE-ORG DATABASES. With one organisation there is
-- exactly one candidate owner and the assignment carries no judgement. With two
-- or more it is a guess, and guessing wrong silently moves financial records
-- between tenants — far worse than leaving them orphaned. Multi-org databases
-- are skipped with a NOTICE naming the counts, for an operator to resolve
-- deliberately.
--
-- Idempotent: once adopted there are no NULLs left, so a re-run matches nothing.
DO $$
DECLARE
  org_count int;
  target_org uuid;
  adopted int;
  total int := 0;
  tbl text;
BEGIN
  SELECT count(*) INTO org_count FROM organizations;

  IF org_count = 0 THEN
    RAISE NOTICE '048: no organizations — nothing to adopt into, skipping.';
    RETURN;
  END IF;

  IF org_count > 1 THEN
    RAISE NOTICE '048: % organizations present — refusing to guess an owner. Orphaned rows left as-is; resolve them deliberately.', org_count;
    FOREACH tbl IN ARRAY ARRAY[
      'products', 'customers', 'orders', 'order_items', 'order_expenses',
      'invoices', 'locations', 'loyalty_tiers', 'promotions',
      'overhead_expenses'
    ]
    LOOP
      EXECUTE format('SELECT count(*) FROM %I WHERE org_id IS NULL', tbl) INTO adopted;
      IF adopted > 0 THEN
        RAISE NOTICE '048:   %: % orphaned row(s)', tbl, adopted;
      END IF;
    END LOOP;
    RETURN;
  END IF;

  SELECT id INTO target_org FROM organizations LIMIT 1;

  FOREACH tbl IN ARRAY ARRAY[
    'products', 'customers', 'orders', 'order_items', 'order_expenses',
    'invoices', 'locations', 'loyalty_tiers', 'promotions',
    'overhead_expenses'
  ]
  LOOP
    -- to_regclass rather than assuming: this runs against databases at
    -- different points in the migration history, and a missing table here
    -- should skip, not abort the whole run.
    IF to_regclass(tbl) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('UPDATE %I SET org_id = $1 WHERE org_id IS NULL', tbl)
      USING target_org;
    GET DIAGNOSTICS adopted = ROW_COUNT;
    IF adopted > 0 THEN
      RAISE NOTICE '048: adopted % orphaned row(s) in % into org %', adopted, tbl, target_org;
      total := total + adopted;
    END IF;
  END LOOP;

  IF total = 0 THEN
    RAISE NOTICE '048: no orphaned rows found — nothing to do.';
  ELSE
    RAISE NOTICE '048: adopted % row(s) in total. 002_org_not_null.sql can now apply.', total;
  END IF;
END $$;
