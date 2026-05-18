-- Phase 11B: suppliers, product-supplier mapping, purchase drafts

CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  contact_name VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  lead_time_days INTEGER NOT NULL DEFAULT 0,
  min_order_value NUMERIC(12, 2) DEFAULT 0,
  min_order_quantity INTEGER DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS suppliers_org_active_idx ON suppliers(org_id, is_active);

CREATE TABLE IF NOT EXISTS product_suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_sku VARCHAR(100),
  cost_price NUMERIC(12, 2),
  pack_size INTEGER NOT NULL DEFAULT 1,
  min_order_qty INTEGER DEFAULT 1,
  lead_time_override_days INTEGER,
  is_preferred INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT product_suppliers_org_product_supplier_uq UNIQUE (org_id, product_id, supplier_id)
);

CREATE INDEX IF NOT EXISTS product_suppliers_org_product_idx ON product_suppliers(org_id, product_id);
CREATE INDEX IF NOT EXISTS product_suppliers_org_supplier_idx ON product_suppliers(org_id, supplier_id);

CREATE TABLE IF NOT EXISTS purchase_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  location_id UUID NOT NULL REFERENCES locations(id),
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  source_recommendation_json JSONB,
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS purchase_drafts_org_status_idx ON purchase_drafts(org_id, status);

CREATE TABLE IF NOT EXISTS purchase_draft_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_draft_id UUID NOT NULL REFERENCES purchase_drafts(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  estimated_cost NUMERIC(12, 2),
  supplier_sku VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS purchase_draft_items_draft_idx ON purchase_draft_items(purchase_draft_id);
