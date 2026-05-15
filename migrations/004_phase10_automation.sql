-- Phase 10: Automation rules, scheduled reports, org notifications, customer override guard

ALTER TABLE customers ALTER COLUMN category TYPE VARCHAR(64);

ALTER TABLE customers ADD COLUMN IF NOT EXISTS manual_override_protected INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS automation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  trigger_event_type VARCHAR(50) NOT NULL,
  condition_json JSONB NOT NULL DEFAULT '{}',
  action_json JSONB NOT NULL DEFAULT '{}',
  priority INTEGER NOT NULL DEFAULT 100,
  is_enabled INTEGER NOT NULL DEFAULT 0,
  last_triggered_at TIMESTAMPTZ,
  execution_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS automation_rules_org_enabled_idx ON automation_rules(org_id, is_enabled);
CREATE INDEX IF NOT EXISTS automation_rules_org_trigger_idx ON automation_rules(org_id, trigger_event_type);

CREATE TABLE IF NOT EXISTS scheduled_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  report_type VARCHAR(64) NOT NULL,
  frequency VARCHAR(20) NOT NULL,
  delivery_methods JSONB NOT NULL DEFAULT '["notification_center"]'::jsonb,
  is_enabled INTEGER NOT NULL DEFAULT 0,
  next_run_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS scheduled_reports_org_next_idx ON scheduled_reports(org_id, is_enabled, next_run_at);

CREATE TABLE IF NOT EXISTS scheduled_report_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES scheduled_reports(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  execution_key VARCHAR(512) NOT NULL UNIQUE,
  status VARCHAR(32) NOT NULL DEFAULT 'completed',
  snapshot_json JSONB,
  error_message VARCHAR(2000),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS scheduled_report_runs_report_idx ON scheduled_report_runs(report_id, completed_at DESC);

CREATE TABLE IF NOT EXISTS org_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'info',
  source VARCHAR(64) NOT NULL,
  metadata JSONB,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS org_notifications_org_created_idx ON org_notifications(org_id, created_at DESC);
