-- v1.2 Phase 2 (PRC-07): price history.
--
-- One row per change to a product's sale price, minimum or cost: the old and
-- new figure, who made it and where it came from (the product form, an import).
-- NULL old/new means the figure was empty (no minimum, cost unknown) — never
-- 0, which would read as a real price.
-- Idempotent: re-applied on every deploy.
CREATE TABLE IF NOT EXISTS product_price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  field varchar(16) NOT NULL,
  old_value numeric(10,2),
  new_value numeric(10,2),
  changed_by varchar(255),
  source varchar(32) NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT product_price_history_field_check CHECK (field IN ('sale', 'min', 'cost'))
);

CREATE INDEX IF NOT EXISTS product_price_history_product_idx
  ON product_price_history (org_id, product_id, created_at);
