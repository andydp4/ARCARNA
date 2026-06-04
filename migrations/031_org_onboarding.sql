-- U6: Org onboarding wizard state (idempotent)
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS onboarding_state jsonb NOT NULL DEFAULT '{}';

-- Existing orgs skip the wizard (grandfather)
UPDATE organizations
SET onboarding_state = '{"completedSteps":["org","currency","location","product","first-sale"],"legacySkip":true}'::jsonb
WHERE onboarding_state = '{}'::jsonb
   OR onboarding_state IS NULL;
