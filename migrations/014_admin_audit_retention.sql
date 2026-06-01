-- H2: Retention horizon for admin audit logs (7 years; append-only, no purge job).
ALTER TABLE admin_audit_logs
  ADD COLUMN IF NOT EXISTS retention_until timestamptz DEFAULT (now() + interval '7 years');

UPDATE admin_audit_logs
  SET retention_until = created_at + interval '7 years'
  WHERE retention_until IS NULL;
