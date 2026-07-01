-- Legacy domain-engine audit log table (apps/server/src/db/schema.ts).
-- Used by the order engine's AuditPortDrizzle; was previously only ever
-- created by hand on existing environments (see AGENTS.md gotcha) and had
-- no tracked migration. Idempotent.
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar(100) NOT NULL,
  user_role varchar(50),
  action varchar(100) NOT NULL,
  entity_type varchar(50) NOT NULL,
  entity_id varchar(100),
  entity_name varchar(255),
  old_values jsonb,
  new_values jsonb,
  ip_address varchar(45),
  user_agent varchar(1024),
  session_id varchar(255),
  success boolean DEFAULT true,
  error_message varchar(1024),
  metadata jsonb,
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at DESC);
