-- Phase 11A: per-location stock + inventory transfers

CREATE TABLE IF NOT EXISTS product_location_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  stock INTEGER NOT NULL DEFAULT 0,
  stock_limit INTEGER NOT NULL DEFAULT 10,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT product_location_stock_org_product_location_uq UNIQUE (org_id, product_id, location_id)
);

CREATE INDEX IF NOT EXISTS product_location_stock_org_location_idx ON product_location_stock(org_id, location_id);
CREATE INDEX IF NOT EXISTS product_location_stock_product_idx ON product_location_stock(product_id);

ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id);
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS transfer_id UUID;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS from_location_id UUID REFERENCES locations(id);
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS to_location_id UUID REFERENCES locations(id);

CREATE TABLE IF NOT EXISTS inventory_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  from_location_id UUID NOT NULL REFERENCES locations(id),
  to_location_id UUID NOT NULL REFERENCES locations(id),
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  notes VARCHAR(2000),
  correlation_id VARCHAR(100),
  requested_by VARCHAR(255),
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inventory_transfers_org_status_idx ON inventory_transfers(org_id, status);

CREATE TABLE IF NOT EXISTS inventory_transfer_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES inventory_transfers(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inventory_transfer_items_transfer_idx ON inventory_transfer_items(transfer_id);
