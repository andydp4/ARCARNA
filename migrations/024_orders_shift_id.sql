-- F2: Link orders to shifts for Z-report (idempotent)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES shifts(id);

CREATE INDEX IF NOT EXISTS orders_shift_id_idx ON orders (shift_id);
