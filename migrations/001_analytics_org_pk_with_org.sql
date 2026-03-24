-- Phase 2B: Analytics multi-tenant migration (multi-org case)
-- Use when multiple organizations exist. Pass org_id via psql variable:
--   psql $DATABASE_URL -v org_id=YOUR_ORG_UUID -f migrations/001_analytics_org_pk_with_org.sql

\if :{?org_id}
\else
\echo 'ERROR: org_id variable required. Run: psql ... -v org_id=YOUR_ORG_UUID -f 001_analytics_org_pk_with_org.sql'
\quit 1
\endif

BEGIN;

-- 1. Add org_id column if missing (nullable)
ALTER TABLE analytics_daily ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE analytics_weekly ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE analytics_monthly ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);

-- 2. Backfill org_id with provided org
UPDATE analytics_daily SET org_id = :'org_id'::uuid WHERE org_id IS NULL;
UPDATE analytics_weekly SET org_id = :'org_id'::uuid WHERE org_id IS NULL;
UPDATE analytics_monthly SET org_id = :'org_id'::uuid WHERE org_id IS NULL;

-- 3. Make org_id NOT NULL
ALTER TABLE analytics_daily ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE analytics_weekly ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE analytics_monthly ALTER COLUMN org_id SET NOT NULL;

-- 4. Drop old PKs and create new composite PKs
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (SELECT conname FROM pg_constraint WHERE conrelid = 'analytics_daily'::regclass AND contype = 'p')
  LOOP EXECUTE format('ALTER TABLE analytics_daily DROP CONSTRAINT %I', r.conname); END LOOP;
  FOR r IN (SELECT conname FROM pg_constraint WHERE conrelid = 'analytics_weekly'::regclass AND contype = 'p')
  LOOP EXECUTE format('ALTER TABLE analytics_weekly DROP CONSTRAINT %I', r.conname); END LOOP;
  FOR r IN (SELECT conname FROM pg_constraint WHERE conrelid = 'analytics_monthly'::regclass AND contype = 'p')
  LOOP EXECUTE format('ALTER TABLE analytics_monthly DROP CONSTRAINT %I', r.conname); END LOOP;
END $$;
ALTER TABLE analytics_daily ADD PRIMARY KEY (org_id, date);
ALTER TABLE analytics_weekly ADD PRIMARY KEY (org_id, year, week);
ALTER TABLE analytics_monthly ADD PRIMARY KEY (org_id, year, month);

COMMIT;
