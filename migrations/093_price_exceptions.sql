-- v1.2 Phase 2 (PRC-03, CMP-03): underpriced sales, recorded silently.
--
-- One row per order line sold below its minimum or below known cost, written
-- by the order engine (till, manager edits, API, voice drafts; the website is
-- exempt because it prices at list). Recording never blocks or fails a sale.
-- Read by the admin-only "Would have flagged" view.
-- Idempotent: re-applied on every deploy.
CREATE TABLE IF NOT EXISTS price_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  user_id varchar(255),
  source varchar(16) NOT NULL,
  channel varchar(16),
  quantity numeric(14,3) NOT NULL,
  unit_price numeric(10,2) NOT NULL,
  list_price numeric(10,2) NOT NULL,
  floor_price numeric(10,2) NOT NULL,
  unit_cost numeric(10,2),
  below_minimum boolean NOT NULL,
  below_cost boolean NOT NULL,
  under_list numeric(12,2) NOT NULL,
  under_cost numeric(12,2) NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT price_exceptions_source_check CHECK (source IN ('sale', 'edit'))
);

CREATE INDEX IF NOT EXISTS price_exceptions_org_created_idx
  ON price_exceptions (org_id, created_at);

-- An order edit reads and replaces that order's rows (one breach, counted once).
CREATE INDEX IF NOT EXISTS price_exceptions_order_idx
  ON price_exceptions (order_id);
