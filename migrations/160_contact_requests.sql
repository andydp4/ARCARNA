-- v1.2 Phase 6 (PRV-09, PRV-10, PRV-11): contact-details requests, 24-hour
-- access and the customer data access log.
--
-- contact_requests: a manager asks for one customer's contact details with a
-- reason code, a note of at least 15 characters, the fields wanted and
-- optionally the order it is about. An admin (or the owner) approves or
-- declines it; approval opens a 24-hour grant (grant_expires_at). A pending
-- request lapses after 48 hours (expires_at). Admins revoke a grant, the
-- manager can end it early. One pending request per customer per manager is
-- held by a partial unique index, so two taps cannot make two.
--
-- customer_access_log: every look at, or change to, a customer's contact
-- details, whoever did it and however: a reveal inside a grant, the driver's
-- call, "Use saved address", a replaced number, an export, a request and its
-- decision, a message sent without showing the number, and an API key reading
-- contact details. The reveal is refused when its row cannot be written.
--
-- Idempotent: re-applied on every deploy.

CREATE TABLE IF NOT EXISTS contact_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  requester_user_id varchar(255) NOT NULL,
  requester_role varchar(16) NOT NULL,
  reason_code varchar(24) NOT NULL,
  note text NOT NULL,
  fields jsonb NOT NULL,
  status varchar(12) NOT NULL DEFAULT 'pending',
  expires_at timestamp NOT NULL,
  decided_by_user_id varchar(255),
  decided_at timestamp,
  decision_note text,
  grant_expires_at timestamp,
  ended_by_user_id varchar(255),
  ended_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT contact_requests_status_check CHECK (status IN ('pending', 'approved', 'declined', 'expired', 'revoked', 'ended')),
  CONSTRAINT contact_requests_reason_check CHECK (reason_code IN ('complaint', 'refund_return', 'delivery_problem', 'lost_property', 'debt_chase', 'other')),
  CONSTRAINT contact_requests_note_check CHECK (char_length(btrim(note)) >= 15)
);

CREATE UNIQUE INDEX IF NOT EXISTS contact_requests_one_pending_uq
  ON contact_requests (org_id, customer_id, requester_user_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS contact_requests_org_status_idx ON contact_requests (org_id, status, created_at);
CREATE INDEX IF NOT EXISTS contact_requests_customer_idx ON contact_requests (org_id, customer_id, created_at);

CREATE TABLE IF NOT EXISTS customer_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  actor_user_id varchar(255) NOT NULL,
  actor_role varchar(16) NOT NULL,
  action varchar(32) NOT NULL,
  field varchar(16),
  request_id uuid REFERENCES contact_requests(id) ON DELETE SET NULL,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  metadata jsonb,
  ip_address varchar(64),
  user_agent text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_access_log_customer_idx ON customer_access_log (org_id, customer_id, created_at);
CREATE INDEX IF NOT EXISTS customer_access_log_org_idx ON customer_access_log (org_id, created_at);
CREATE INDEX IF NOT EXISTS customer_access_log_actor_idx ON customer_access_log (org_id, actor_user_id, created_at);
