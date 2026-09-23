-- v1.2 Phase 4 (PRC-02, CMP-05): price guard at the till.
--
-- The admin switch, OFF by default: the owner wants two weeks of Phase 2's
-- silent recording before the till says anything. While it is off nothing
-- below is written for a sale the till did not confirm.
--
-- price_guard_orders: one row per order the guard has something to say about
-- (below the minimum, keyed or after discounts; below cost after all
-- discounts). It carries the cashier's reason, whether every flagged line was
-- confirmed (an unconfirmed arrival is stored at the higher severity), the
-- order-level cost check, and the "Manager agreed" question and its answer.
-- The lines themselves stay in price_exceptions (migration 093).
-- Idempotent: re-applied on every deploy.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS price_guard_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS price_guard_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id varchar(255),
  reason varchar(24),
  reason_note text,
  -- NULL: no line needed the cashier's confirmation (discounts or cost only).
  confirmed boolean,
  offline boolean NOT NULL DEFAULT false,
  confirmed_at varchar(40),
  severity varchar(8) NOT NULL,
  flagged_lines integer NOT NULL DEFAULT 0,
  unconfirmed_lines integer NOT NULL DEFAULT 0,
  under_minimum numeric(12,2) NOT NULL DEFAULT '0',
  lines_below_cost integer NOT NULL DEFAULT 0,
  order_below_cost boolean NOT NULL DEFAULT false,
  under_cost numeric(12,2) NOT NULL DEFAULT '0',
  manager_user_id varchar(255),
  manager_answer varchar(8),
  manager_answered_at timestamp,
  signal_id uuid,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT price_guard_orders_severity_check CHECK (severity IN ('warning', 'error')),
  CONSTRAINT price_guard_orders_answer_check CHECK (manager_answer IS NULL OR manager_answer IN ('yes', 'no'))
);

CREATE UNIQUE INDEX IF NOT EXISTS price_guard_orders_order_uq ON price_guard_orders (order_id);
CREATE INDEX IF NOT EXISTS price_guard_orders_org_created_idx ON price_guard_orders (org_id, created_at);
