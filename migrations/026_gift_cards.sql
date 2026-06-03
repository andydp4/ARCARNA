-- F4: Gift cards (idempotent)
CREATE TABLE IF NOT EXISTS gift_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code varchar(32) NOT NULL UNIQUE,
  balance numeric(10, 2) NOT NULL,
  original_amount numeric(10, 2) NOT NULL,
  currency varchar(3) NOT NULL DEFAULT 'GBP',
  issued_to_customer_id uuid REFERENCES customers(id),
  issued_by_user_id varchar(255) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'redeemed', 'expired', 'void')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gift_cards_org_id_idx ON gift_cards (org_id);
CREATE INDEX IF NOT EXISTS gift_cards_customer_id_idx ON gift_cards (issued_to_customer_id);
CREATE INDEX IF NOT EXISTS gift_cards_code_idx ON gift_cards (code);
