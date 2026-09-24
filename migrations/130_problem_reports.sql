-- v1.2 Phase 8A (UXA-09, UXA-06, UXA-14): the "Problem?" button.
--
-- problem_reports: one row per report a member of staff sends from the till
-- or the header. It carries the chip, an optional note (scrubbed of contact
-- and card details on the server), the screen as a route shape, the device
-- name from the fixed list, the app version, online status and the till's
-- queue counts. reporter_role is what the inbox shows; reporter_user_id is
-- kept only so "Thanks, fixed in version X" can reach them, and is never
-- shown in the inbox or sent to Sentry (owner decision Q18).
--
-- client_ref makes a report queued offline and sent twice land once.
-- Idempotent: re-applied on every deploy.
CREATE TABLE IF NOT EXISTS problem_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reporter_user_id varchar(255) NOT NULL,
  reporter_role varchar(16) NOT NULL,
  client_ref varchar(64) NOT NULL,
  chip varchar(16) NOT NULL,
  note text,
  screen varchar(120) NOT NULL,
  device varchar(32) NOT NULL,
  app_version varchar(32),
  online boolean NOT NULL,
  queue jsonb NOT NULL,
  status varchar(8) NOT NULL DEFAULT 'open',
  fixed_in_version varchar(32),
  resolved_by varchar(255),
  resolved_at timestamp,
  reported_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT problem_reports_chip_check CHECK (chip IN ('too_slow', 'cant_find', 'wrong_thing', 'error_message', 'other')),
  CONSTRAINT problem_reports_status_check CHECK (status IN ('open', 'fixed', 'closed')),
  CONSTRAINT problem_reports_fixed_check CHECK (status <> 'fixed' OR fixed_in_version IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS problem_reports_client_ref_uq ON problem_reports (org_id, reporter_user_id, client_ref);
CREATE INDEX IF NOT EXISTS problem_reports_org_status_idx ON problem_reports (org_id, status, created_at);
CREATE INDEX IF NOT EXISTS problem_reports_reporter_idx ON problem_reports (reporter_user_id, created_at);
