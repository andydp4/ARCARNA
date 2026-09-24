-- v1.2 Stripe links: "Card (link)" at the till.
--
-- The customer pays on their own phone through a Stripe Checkout Session, so
-- a card-link tender leg exists before the money does. order_payments gains a
-- status: 'paid' (every existing leg, and every other tender) or 'awaiting'
-- (a card-link leg Stripe has not yet confirmed). An awaiting leg is never
-- counted as money taken. provider / provider_ref / paid_at record who
-- confirmed it and Stripe's payment reference.
--
-- card_payment_links: one row per Checkout Session made for an awaiting leg.
-- At most one is open per leg at a time (a double tap returns the same one).
--
-- stripe_webhook_events: every Stripe event id handled, so a redelivered
-- event is a no-op.
-- Idempotent: re-applied on every deploy.
ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS status varchar(16) NOT NULL DEFAULT 'paid';
ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS provider varchar(16);
ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS provider_ref varchar(255);
ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS paid_at timestamp;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_payments_status_check') THEN
    ALTER TABLE order_payments
      ADD CONSTRAINT order_payments_status_check CHECK (status IN ('paid', 'awaiting'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS order_payments_awaiting_idx
  ON order_payments (org_id, order_id)
  WHERE status = 'awaiting';

CREATE TABLE IF NOT EXISTS card_payment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES order_payments(id) ON DELETE CASCADE,
  provider varchar(16) NOT NULL DEFAULT 'stripe',
  session_id varchar(255),
  url text,
  amount numeric(12,2) NOT NULL,
  currency varchar(3) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'open',
  expires_at timestamp NOT NULL,
  created_by_user_id varchar(255),
  payment_intent_id varchar(255),
  paid_at timestamp,
  closed_reason text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT card_payment_links_status_check CHECK (status IN ('open', 'paid', 'expired', 'cancelled', 'mismatch')),
  CONSTRAINT card_payment_links_amount_check CHECK (amount > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS card_payment_links_session_uq
  ON card_payment_links (session_id)
  WHERE session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS card_payment_links_open_uq
  ON card_payment_links (payment_id)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS card_payment_links_order_idx ON card_payment_links (org_id, order_id);

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id varchar(255) PRIMARY KEY,
  type varchar(100) NOT NULL,
  outcome varchar(32) NOT NULL,
  received_at timestamp NOT NULL DEFAULT now()
);
