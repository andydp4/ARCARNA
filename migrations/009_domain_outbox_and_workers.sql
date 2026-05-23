-- Domain outbox (analytics worker) + Phase 10 event bus tables
-- Safe to re-run: uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS

CREATE TABLE IF NOT EXISTS domain_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  type VARCHAR(128) NOT NULL,
  data JSONB,
  event_type VARCHAR(128),
  aggregate_type VARCHAR(128),
  aggregate_id VARCHAR(255),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE domain_outbox ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE domain_outbox ADD COLUMN IF NOT EXISTS data JSONB;
ALTER TABLE domain_outbox ADD COLUMN IF NOT EXISTS event_type VARCHAR(128);
ALTER TABLE domain_outbox ADD COLUMN IF NOT EXISTS aggregate_type VARCHAR(128);
ALTER TABLE domain_outbox ADD COLUMN IF NOT EXISTS aggregate_id VARCHAR(255);
ALTER TABLE domain_outbox ADD COLUMN IF NOT EXISTS payload JSONB;
ALTER TABLE domain_outbox ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
ALTER TABLE domain_outbox ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Align manually patched Neon rows: payload <-> data, type -> event_type
UPDATE domain_outbox
SET payload = COALESCE(payload, data, '{}'::jsonb)
WHERE payload IS NULL;

UPDATE domain_outbox
SET data = COALESCE(data, payload)
WHERE data IS NULL AND payload IS NOT NULL;

UPDATE domain_outbox
SET event_type = COALESCE(event_type, type)
WHERE event_type IS NULL AND type IS NOT NULL;

ALTER TABLE domain_outbox ALTER COLUMN payload SET DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS domain_outbox_unprocessed_idx
  ON domain_outbox (created_at)
  WHERE processed_at IS NULL;

-- Event bus (server/eventBus.ts)
CREATE TABLE IF NOT EXISTS event_outbox (
  event_id VARCHAR(36) PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  correlation_id VARCHAR(100) NOT NULL,
  actor JSONB,
  source VARCHAR(100),
  version INTEGER NOT NULL DEFAULT 1,
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS event_outbox_status_occurred_idx
  ON event_outbox (status, occurred_at);
CREATE INDEX IF NOT EXISTS event_outbox_correlation_idx
  ON event_outbox (correlation_id);

CREATE TABLE IF NOT EXISTS job_queue (
  job_id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  event_id VARCHAR(36) NOT NULL REFERENCES event_outbox(event_id),
  worker_name VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 10,
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by VARCHAR(100),
  last_error VARCHAR(2000),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_queue_status_run_at_idx ON job_queue (status, run_at);
CREATE INDEX IF NOT EXISTS job_queue_event_worker_idx ON job_queue (event_id, worker_name);

CREATE TABLE IF NOT EXISTS processed_events (
  event_id VARCHAR(36) NOT NULL,
  worker_name VARCHAR(50) NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  result_summary VARCHAR(500),
  PRIMARY KEY (event_id, worker_name)
);

CREATE TABLE IF NOT EXISTS worker_run_logs (
  log_id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  event_id VARCHAR(36) NOT NULL,
  correlation_id VARCHAR(100) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  worker_name VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  summary VARCHAR(500),
  data JSONB,
  error VARCHAR(2000),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS worker_run_logs_event_idx ON worker_run_logs (event_id);
