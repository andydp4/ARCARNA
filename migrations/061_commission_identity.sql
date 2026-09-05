-- Commission is owed to a PERSON, and since L2 that person has no cashier code.
--
-- 057 added `user_id` alongside `cashier_id` here, but left `cashier_id` NOT
-- NULL and left both uniqueness rules keyed on it. That was survivable only
-- while every shift still had a code. L2 removed the manual open that assigned
-- one, so from the cutover on there is nothing to put in the column and nothing
-- for the guards to key on.
--
-- Three things follow, and the third is the dangerous one.

-- 1. A code is no longer required to be owed money.
ALTER TABLE cashier_commission_entries
  ALTER COLUMN cashier_id DROP NOT NULL;

-- 2. But SOMEBODY has to be named. An entry identifying nobody is money owed to
--    no one, and it would sit in the ledger inflating the total a shift thinks
--    it accrued. The code cannot produce one — buildOrderCommission returns no
--    entries when it can resolve no party — so this only has to catch a
--    regression, which is exactly what it is for.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cashier_commission_entries_party_check'
  ) THEN
    ALTER TABLE cashier_commission_entries
      ADD CONSTRAINT cashier_commission_entries_party_check
      CHECK (cashier_id IS NOT NULL OR user_id IS NOT NULL);
  END IF;
END $$;

-- 3. The guards against paying twice have to key on the same identity the code
--    now pays.
--
--    This is the part that fails silently rather than loudly. In Postgres, NULLs
--    in a unique index are DISTINCT from one another: an index on
--    (order_id, cashier_id, role) stops deduplicating the moment cashier_id is
--    null, because every row's key is unique by virtue of being null. Closing a
--    shift twice, or replaying an offline order into a closed one, would then
--    write a second entry and pay somebody the same commission again — with no
--    error, and the ledger looking perfectly ordinary.
--
--    COALESCE(cashier_id::text, user_id) is the same party the accrual keys on:
--    the user when there is one, the code otherwise. Both casts are immutable,
--    so they are indexable. Every existing row has a code, so the new keys equal
--    the old ones and no row can conflict on the rebuild.
DROP INDEX IF EXISTS cashier_commission_entries_unique_sale;
DROP INDEX IF EXISTS cashier_commission_entries_unique_resolution;

CREATE UNIQUE INDEX IF NOT EXISTS cashier_commission_entries_unique_sale
  ON cashier_commission_entries (order_id, COALESCE(cashier_id::text, user_id), role)
  WHERE basis = 'sale' AND reversal_of IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cashier_commission_entries_unique_resolution
  ON cashier_commission_entries (credit_payment_id, COALESCE(cashier_id::text, user_id), role)
  WHERE basis = 'credit_resolution' AND reversal_of IS NULL;

-- Fail loudly rather than leave either guard off. Without them the ledger pays
-- twice in silence, which is the one failure mode nobody would catch by looking.
DO $$
DECLARE
  present int;
BEGIN
  SELECT count(*) INTO present FROM pg_indexes
   WHERE schemaname = 'public'
     AND indexname IN (
       'cashier_commission_entries_unique_sale',
       'cashier_commission_entries_unique_resolution'
     );
  IF present <> 2 THEN
    RAISE EXCEPTION
      'Only % of 2 commission double-pay guards exist. Duplicate entries are present and must be resolved before deploying.',
      present;
  END IF;
END $$;
