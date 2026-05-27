-- S7: Append-only admin / security audit trail (super-admin visibility).
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
