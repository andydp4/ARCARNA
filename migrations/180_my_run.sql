-- My run (v1.2): the driver's phone view of their own deliveries.
-- Re-applied on every deploy, so every statement is idempotent.

-- 1. The order a driver chose for their stops, per person per trading day.
--    Only ids: the stops themselves are always read fresh from orders, so a
--    stale list can reorder but never show an order that is no longer theirs.
CREATE TABLE IF NOT EXISTS delivery_run_orders (
  org_id uuid NOT NULL,
  user_id varchar(255) NOT NULL,
  run_date date NOT NULL,
  order_ids jsonb NOT NULL,
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT delivery_run_orders_org_id_user_id_run_date_pk PRIMARY KEY (org_id, user_id, run_date)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'delivery_run_orders_org_id_organizations_id_fk'
  ) THEN
    ALTER TABLE delivery_run_orders
      ADD CONSTRAINT delivery_run_orders_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 2. "Couldn't deliver" leaves a note on the board card: why, and when. The
--    order goes back to ready; the next driver sees what happened last time.
--    Kept on the order (not a new order_events kind) so this migration does
--    not have to rewrite order_events_kind_check.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_issue varchar(600);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_issue_at timestamp;
