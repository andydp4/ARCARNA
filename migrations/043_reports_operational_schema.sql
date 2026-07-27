-- ARC-RPT-SPEC-001 exportable reports: operational order fields + satisfaction,
-- reseller partner ledger. All additive and idempotent (safe to re-run).

-- Order Status Dashboard (ARC-T1-003) + Delay Log (ARC-T1-005) operational fields.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS queue_position integer,
  ADD COLUMN IF NOT EXISTS eta_given timestamp,
  ADD COLUMN IF NOT EXISTS delay_flag boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delay_reason varchar(255),
  ADD COLUMN IF NOT EXISTS delay_cause varchar(32),
  ADD COLUMN IF NOT EXISTS original_eta timestamp,
  ADD COLUMN IF NOT EXISTS revised_eta timestamp,
  ADD COLUMN IF NOT EXISTS delay_notification_sent_at timestamp,
  ADD COLUMN IF NOT EXISTS delay_resolution varchar(32);

CREATE INDEX IF NOT EXISTS orders_delay_flag_idx ON orders (org_id, delay_flag);

-- Customer Satisfaction Report (ARC-T2-003).
CREATE TABLE IF NOT EXISTS satisfaction_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  staff_id uuid REFERENCES cashier_profiles(id) ON DELETE SET NULL,
  score integer NOT NULL,
  comment text,
  score_date timestamp NOT NULL DEFAULT now(),
  followed_up_at timestamp,
  created_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS satisfaction_scores_org_date_idx ON satisfaction_scores (org_id, score_date);
CREATE INDEX IF NOT EXISTS satisfaction_scores_customer_idx ON satisfaction_scores (customer_id);

-- Reseller Credit & Payment Report (ARC-T2-004).
CREATE TABLE IF NOT EXISTS reseller_partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name varchar(255) NOT NULL,
  partner_code varchar(20) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reseller_partners_org_idx ON reseller_partners (org_id);

CREATE TABLE IF NOT EXISTS reseller_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES reseller_partners(id) ON DELETE CASCADE,
  type varchar(16) NOT NULL,
  amount numeric(12,2) NOT NULL,
  occurred_at timestamp NOT NULL DEFAULT now(),
  invoice_date timestamp,
  paid boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reseller_tx_partner_idx ON reseller_transactions (partner_id);
CREATE INDEX IF NOT EXISTS reseller_tx_org_idx ON reseller_transactions (org_id);
