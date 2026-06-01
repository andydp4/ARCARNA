-- F3: Refunds + line-level partial refunds (idempotent)
CREATE TABLE IF NOT EXISTS refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cashier_id varchar(255) NOT NULL,
  shift_id uuid REFERENCES shifts(id),
  reason varchar(32) NOT NULL,
  notes text,
  refund_method varchar(16) NOT NULL
    CHECK (refund_method IN ('original', 'cash', 'store_credit')),
  total numeric(10, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS refunds_order_id_idx ON refunds (order_id);
CREATE INDEX IF NOT EXISTS refunds_org_id_idx ON refunds (org_id);
CREATE INDEX IF NOT EXISTS refunds_shift_id_idx ON refunds (shift_id);

CREATE TABLE IF NOT EXISTS refund_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id uuid NOT NULL REFERENCES refunds(id) ON DELETE CASCADE,
  order_line_id uuid NOT NULL REFERENCES order_items(id),
  qty integer NOT NULL CHECK (qty > 0),
  amount numeric(10, 2) NOT NULL
);

CREATE INDEX IF NOT EXISTS refund_lines_refund_id_idx ON refund_lines (refund_id);
CREATE INDEX IF NOT EXISTS refund_lines_order_line_id_idx ON refund_lines (order_line_id);
