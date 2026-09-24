-- v1.2 Ask arcarna: plain-English questions answered from the shop's own
-- Evidence, read-only and inside the asker's role.
--
-- ask_settings: one row per org, admin-only and every change logged in
-- admin_audit_logs. monthly_cap_gbp stops new questions once the month's
-- estimated spend reaches it (0 pauses the feature); usd_to_gbp converts the
-- model's published US dollar price into the pounds shown here.
--
-- ask_questions: the audit row per question and the per-org usage record the
-- spend cap is summed from. Who, role, when, which tools ran, token counts and
-- the estimated cost. Never the answer. The question is kept for admins only,
-- scrubbed of phone numbers, emails, card numbers and postcodes first
-- (question_scrubbed says whether anything was taken out).
--
-- Idempotent: re-applied on every deploy.
CREATE TABLE IF NOT EXISTS ask_settings (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  monthly_cap_gbp numeric(10,2) NOT NULL DEFAULT 25.00,
  usd_to_gbp numeric(8,4) NOT NULL DEFAULT 0.7900,
  updated_by varchar(255),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT ask_settings_cap_check CHECK (monthly_cap_gbp >= 0),
  CONSTRAINT ask_settings_rate_check CHECK (usd_to_gbp > 0)
);

CREATE TABLE IF NOT EXISTS ask_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id varchar(255) NOT NULL,
  role varchar(16) NOT NULL,
  asked_at timestamp NOT NULL DEFAULT now(),
  question varchar(1000) NOT NULL DEFAULT '',
  question_scrubbed boolean NOT NULL DEFAULT false,
  tools jsonb NOT NULL DEFAULT '[]'::jsonb,
  model varchar(64) NOT NULL,
  served_by_fallback boolean NOT NULL DEFAULT false,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cache_read_tokens integer NOT NULL DEFAULT 0,
  cache_write_tokens integer NOT NULL DEFAULT 0,
  cost_gbp numeric(12,4) NOT NULL DEFAULT '0',
  outcome varchar(16) NOT NULL,
  CONSTRAINT ask_questions_outcome_check CHECK (outcome IN ('answered', 'refused', 'cut_short', 'error', 'stopped'))
);

CREATE INDEX IF NOT EXISTS ask_questions_org_time_idx ON ask_questions (org_id, asked_at);
CREATE INDEX IF NOT EXISTS ask_questions_user_idx ON ask_questions (user_id, asked_at);
