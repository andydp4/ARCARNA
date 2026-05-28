-- M3: per-org feature flags (idempotent)
CREATE TABLE IF NOT EXISTS feature_flags (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  flag varchar(64) NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, flag)
);

CREATE INDEX IF NOT EXISTS feature_flags_org_id_idx ON feature_flags (org_id);
