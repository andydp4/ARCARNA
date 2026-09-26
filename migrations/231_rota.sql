-- v1.2.1: the rota — recurring weekly patterns, date overrides (covers,
-- swaps, and approved time-off), and time-off requests. Entirely separate
-- from cashier_shifts (what someone actually clocked): a rota entry never
-- opens, blocks, or requires an actual shift.
--
-- Idempotent: re-applied on every deploy.

CREATE TABLE IF NOT EXISTS shift_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id varchar(255) NOT NULL,
  location_id uuid REFERENCES locations(id),
  day_of_week integer NOT NULL,
  start_time varchar(5) NOT NULL,
  end_time varchar(5) NOT NULL,
  effective_from date NOT NULL,
  effective_until date,
  is_active integer NOT NULL DEFAULT 1,
  created_by_user_id varchar(255),
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shift_patterns_org_user_idx ON shift_patterns (org_id, user_id);
CREATE INDEX IF NOT EXISTS shift_patterns_org_dow_idx ON shift_patterns (org_id, day_of_week);

CREATE TABLE IF NOT EXISTS shift_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id varchar(255) NOT NULL,
  date date NOT NULL,
  status varchar(16) NOT NULL,
  start_time varchar(5),
  end_time varchar(5),
  note varchar(500),
  time_off_request_id uuid,
  created_by_user_id varchar(255),
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS shift_overrides_org_user_date_idx ON shift_overrides (org_id, user_id, date);

CREATE TABLE IF NOT EXISTS time_off_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id varchar(255) NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason varchar(500),
  status varchar(16) NOT NULL DEFAULT 'pending',
  decided_by_user_id varchar(255),
  decided_at timestamp,
  decision_note varchar(500),
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS time_off_requests_org_user_idx ON time_off_requests (org_id, user_id);
CREATE INDEX IF NOT EXISTS time_off_requests_org_status_idx ON time_off_requests (org_id, status);
