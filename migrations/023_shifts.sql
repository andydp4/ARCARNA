-- F2: Cashier shifts (idempotent)
CREATE TABLE IF NOT EXISTS shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id),
  user_id varchar(255) NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  opening_float numeric(10, 2) NOT NULL DEFAULT 0,
  closing_count numeric(10, 2),
  expected_cash numeric(10, 2),
  variance numeric(10, 2),
  notes text,
  reopen_reason text,
  status varchar(16) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'reopened'))
);

CREATE INDEX IF NOT EXISTS shifts_org_location_idx ON shifts (org_id, location_id);
CREATE INDEX IF NOT EXISTS shifts_user_status_idx ON shifts (user_id, status);
CREATE INDEX IF NOT EXISTS shifts_opened_at_idx ON shifts (opened_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS shifts_one_open_per_user_location_idx
  ON shifts (org_id, location_id, user_id)
  WHERE status = 'open';
