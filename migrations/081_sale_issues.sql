-- v1.2 Phase 1A: till sales the server refused ("Needs attention").
--
-- A sale queued offline and refused when it was finally sent used to stay in
-- the till's browser storage, retried for ever and deleted on sign-out. The
-- till now reports it here so a manager can retry, edit, export or discard it
-- from any device. One row per sale reference per org.
-- Idempotent: re-applied on every deploy.
CREATE TABLE IF NOT EXISTS sale_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_order_id varchar(64) NOT NULL,
  location_id uuid,
  rung_by_user_id varchar(255) NOT NULL,
  payload jsonb NOT NULL,
  reason text NOT NULL,
  http_status integer,
  queued_at timestamp,
  status varchar(16) NOT NULL DEFAULT 'open',
  resolved_order_id uuid,
  resolved_by_user_id varchar(255),
  resolved_at timestamp,
  discard_reason text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT sale_issues_status_check CHECK (status IN ('open', 'resolved', 'discarded'))
);

CREATE UNIQUE INDEX IF NOT EXISTS sale_issues_org_ref_uq ON sale_issues (org_id, client_order_id);
CREATE INDEX IF NOT EXISTS sale_issues_org_status_idx ON sale_issues (org_id, status);
