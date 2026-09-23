-- v1.2 Phase 4 (PRC-04, CMP-02, CMP-04): review of exceptions.
--
-- Admin settings on the org:
--   price_guard_min_signal     'immediate' or 'twice_daily': when below-minimum
--                              Signals go out. Below cost is always immediate.
--   refund_cash_over           a cash refund over this (£) raises an exception.
--   refund_after_days          a refund this many days or more after the sale
--                              raises an exception.
--   refund_same_cashier_hours  Price overrides Evidence counts refunds by the
--                              cashier who rang a flagged sale within this many
--                              hours of it.
--
-- price_guard_orders.signal_pending: a below-minimum order held for the next
-- twice-daily round-up. Claimed (set false) by the one run that sends it.
--
-- exception_reviews: the Needs a look inbox. One row per exception — a flagged
-- sale (price_guard_orders) or a refund the rules pick out — with its state,
-- reviewer and note. subject_role is the role of the person it is about, as it
-- was when raised, and picks the queue: managers review cashiers', admins
-- review managers' too, and the owner sees everything.
-- Idempotent: re-applied on every deploy.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS price_guard_min_signal varchar(12) NOT NULL DEFAULT 'immediate';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS refund_cash_over numeric(10,2) NOT NULL DEFAULT '50';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS refund_after_days integer NOT NULL DEFAULT 14;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS refund_same_cashier_hours integer NOT NULL DEFAULT 24;

ALTER TABLE price_guard_orders ADD COLUMN IF NOT EXISTS signal_pending boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS price_guard_orders_pending_idx
  ON price_guard_orders (org_id, created_at)
  WHERE signal_pending;

CREATE TABLE IF NOT EXISTS exception_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind varchar(12) NOT NULL,
  source_id uuid NOT NULL,
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  subject_user_id varchar(255),
  subject_role varchar(16),
  severity varchar(8) NOT NULL,
  summary text NOT NULL,
  amount numeric(12,2),
  rules jsonb,
  state varchar(12) NOT NULL DEFAULT 'open',
  reviewer_id varchar(255),
  note text,
  reviewed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT exception_reviews_kind_check CHECK (kind IN ('price', 'refund')),
  CONSTRAINT exception_reviews_state_check CHECK (state IN ('open', 'acknowledged', 'explained', 'escalated')),
  CONSTRAINT exception_reviews_severity_check CHECK (severity IN ('warning', 'error'))
);

CREATE UNIQUE INDEX IF NOT EXISTS exception_reviews_source_uq ON exception_reviews (kind, source_id);
CREATE INDEX IF NOT EXISTS exception_reviews_org_state_idx ON exception_reviews (org_id, state, created_at);
CREATE INDEX IF NOT EXISTS exception_reviews_subject_idx ON exception_reviews (org_id, subject_user_id, created_at);
