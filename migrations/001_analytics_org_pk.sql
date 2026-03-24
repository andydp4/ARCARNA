-- Phase 2B: Analytics multi-tenant migration
-- Run ONLY on existing DBs with old analytics structure (date/week/month as sole PK).
-- For fresh DBs, use: npm run db:push
--
-- PRE-REQUISITE: 0 or 1 org must exist. If multiple orgs exist, set MIGRATION_ANALYTICS_ORG_ID
-- and use 001_analytics_org_pk_with_org.sql instead, or consolidate to single org first.

BEGIN;

-- 0. Pre-check: forbid silently picking LIMIT 1 when multiple orgs exist
DO $$
DECLARE
  org_count INT;
BEGIN
  SELECT COUNT(*) INTO org_count FROM organizations;
  IF org_count > 1 THEN
    -- Allow override via psql variable (run: psql ... -v org_id=UUID -f 001_analytics_org_pk_with_org.sql)
    -- This script uses default-org path; for multi-org use 001_analytics_org_pk_with_org.sql
    RAISE EXCEPTION 'Multiple organizations exist (%). Do NOT run this script. Use 001_analytics_org_pk_with_org.sql with -v org_id=YOUR_ORG_UUID, or consolidate to single org first.', org_count;
  END IF;
END $$;

-- 1. Add org_id column if missing (nullable)
ALTER TABLE analytics_daily ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE analytics_weekly ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);
ALTER TABLE analytics_monthly ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);

-- 2. Get or create default org
INSERT INTO organizations (id, name, created_at, updated_at)
SELECT gen_random_uuid(), 'Default Organization', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM organizations LIMIT 1);

-- 3. Backfill org_id with default org (single-tenant legacy)
DO $$
DECLARE
  default_org_id UUID;
BEGIN
  SELECT id INTO default_org_id FROM organizations LIMIT 1;
  UPDATE analytics_daily SET org_id = default_org_id WHERE org_id IS NULL;
  UPDATE analytics_weekly SET org_id = default_org_id WHERE org_id IS NULL;
  UPDATE analytics_monthly SET org_id = default_org_id WHERE org_id IS NULL;
END $$;

-- 4. Make org_id NOT NULL
ALTER TABLE analytics_daily ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE analytics_weekly ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE analytics_monthly ALTER COLUMN org_id SET NOT NULL;

-- 5. Drop old PKs and create new composite PKs (drop by name from pg_constraint)
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
