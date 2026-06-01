-- H2 / S7: Admin audit table (if missing on older DBs) + 7-year retention column.
-- Safe to re-run (IF NOT EXISTS).

-- From 011_admin_audit_logs.sql — production may have skipped 011 if only db:push was used.
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  actor_user_id varchar(255) NOT NULL,
  actor_role varchar(32),
  action varchar(120) NOT NULL,
  target_type varchar(64),
  target_id varchar(255),
  metadata jsonb,
  ip_address varchar(45),
  user_agent varchar(1024),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_logs_created_at_idx ON admin_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_logs_actor_idx ON admin_audit_logs (actor_user_id);

ALTER TABLE admin_audit_logs
  ADD COLUMN IF NOT EXISTS retention_until timestamptz DEFAULT (now() + interval '7 years');

UPDATE admin_audit_logs
  SET retention_until = created_at + interval '7 years'
  WHERE retention_until IS NULL;
