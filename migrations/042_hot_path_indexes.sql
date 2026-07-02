-- Indexes for tables that are queried per-order-item/per-org on hot paths
-- (order detail views, invoices, refunds, Z-reports) but had none, risking
-- sequential scans as order volume grows.
CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items(order_id);
CREATE INDEX IF NOT EXISTS order_items_org_id_idx ON order_items(org_id);
CREATE INDEX IF NOT EXISTS customers_org_id_idx ON customers(org_id);
CREATE INDEX IF NOT EXISTS invoices_org_id_idx ON invoices(org_id);
CREATE INDEX IF NOT EXISTS invoices_order_id_idx ON invoices(order_id);
