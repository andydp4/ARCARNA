-- C1: Channel readiness — order provenance + API keys + outbound webhooks
ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel varchar(32) NOT NULL DEFAULT 'pos';

CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name varchar(255) NOT NULL,
  key_lookup varchar(64) NOT NULL,
  secret_hash varchar(255) NOT NULL,
  scopes jsonb NOT NULL DEFAULT '["products:read"]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS api_keys_org_lookup_active_idx
  ON api_keys (org_id, key_lookup)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS outbound_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  url varchar(2048) NOT NULL,
  secret varchar(512) NOT NULL,
  event_types jsonb NOT NULL DEFAULT '["OrderCreated"]'::jsonb,
  is_active int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outbound_webhooks_org_idx ON outbound_webhooks (org_id);
