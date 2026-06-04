-- F5: Loyalty redemption settings per org (idempotent)
CREATE TABLE IF NOT EXISTS loyalty_settings (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  redemption_rate numeric(10, 4) NOT NULL DEFAULT 0.01,
  min_redeem_points integer NOT NULL DEFAULT 100,
  updated_at timestamptz NOT NULL DEFAULT now()
);
