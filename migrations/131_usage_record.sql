-- v1.2 Phase 8B/8C (UXA-07, UXA-08, UXA-13): our own usage record and
-- Friction Truths.
--
-- usage_events: raw events from the tills and phones, sent in batches. Each
-- row carries a role and a device name, never a person (owner decision Q18):
-- there is no user column here and none may be added. screen is a route
-- shape, label is a message title (scrubbed), a call's route shape, a crash
-- kind or a sale step. No screen text, typed values, money or names.
-- device_key is a random id the browser made for itself, used only for the
-- per-device limit (the tills share one address) and device health.
-- Kept 90 days; `rolled` marks rows already counted into usage_daily.
--
-- usage_daily: the daily summaries Friction Truths reads, kept 24 months.
-- Recomputed from the raw rows for any day that gains events.
--
-- usage_study_windows: the owner's "improvement study" setting for a future
-- outside recorder. Off by default; nothing is recorded by it (no recorder
-- is connected). When on, staff on the chosen screens see a banner.
--
-- Idempotent: re-applied on every deploy.
CREATE TABLE IF NOT EXISTS usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind varchar(8) NOT NULL,
  role varchar(16) NOT NULL,
  device varchar(32) NOT NULL,
  device_key varchar(64) NOT NULL,
  app_version varchar(32),
  screen varchar(120) NOT NULL DEFAULT '',
  label varchar(120) NOT NULL DEFAULT '',
  active_ms integer NOT NULL DEFAULT 0,
  open_ms integer NOT NULL DEFAULT 0,
  duration_ms integer NOT NULL DEFAULT 0,
  slow boolean NOT NULL DEFAULT false,
  failed boolean NOT NULL DEFAULT false,
  occurred_at timestamp NOT NULL,
  received_at timestamp NOT NULL DEFAULT now(),
  rolled boolean NOT NULL DEFAULT false,
  CONSTRAINT usage_events_kind_check CHECK (kind IN ('screen', 'message', 'call', 'crash', 'offline', 'funnel'))
);

CREATE INDEX IF NOT EXISTS usage_events_org_time_idx ON usage_events (org_id, occurred_at);
CREATE INDEX IF NOT EXISTS usage_events_device_idx ON usage_events (org_id, device_key, received_at);
CREATE INDEX IF NOT EXISTS usage_events_org_received_idx ON usage_events (org_id, received_at);
CREATE INDEX IF NOT EXISTS usage_events_rolled_idx ON usage_events (rolled, org_id);

CREATE TABLE IF NOT EXISTS usage_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  day date NOT NULL,
  kind varchar(8) NOT NULL,
  role varchar(16) NOT NULL,
  device varchar(32) NOT NULL,
  screen varchar(120) NOT NULL DEFAULT '',
  label varchar(120) NOT NULL DEFAULT '',
  count integer NOT NULL DEFAULT 0,
  active_ms bigint NOT NULL DEFAULT 0,
  open_ms bigint NOT NULL DEFAULT 0,
  duration_ms bigint NOT NULL DEFAULT 0,
  slow integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS usage_daily_key_uq ON usage_daily (org_id, day, kind, role, device, screen, label);
CREATE INDEX IF NOT EXISTS usage_daily_org_day_idx ON usage_daily (org_id, day);

CREATE TABLE IF NOT EXISTS usage_study_windows (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  screens jsonb NOT NULL DEFAULT '[]'::jsonb,
  ends_on date,
  updated_at timestamp NOT NULL DEFAULT now()
);
