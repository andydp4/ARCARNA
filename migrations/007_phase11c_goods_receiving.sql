-- Phase 11C: goods receiving

ALTER TABLE purchase_draft_items
  ADD COLUMN IF NOT EXISTS quantity_received INTEGER NOT NULL DEFAULT 0;

ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS goods_receipt_id UUID;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS purchase_draft_id UUID;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS supplier_id UUID;

CREATE TABLE IF NOT EXISTS goods_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  purchase_draft_id UUID NOT NULL REFERENCES purchase_drafts(id),
  location_id UUID NOT NULL REFERENCES locations(id),
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  supplier_reference VARCHAR(255),
  delivery_note VARCHAR(500),
  received_by VARCHAR(255),
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS goods_receipts_org_draft_idx ON goods_receipts(org_id, purchase_draft_id);
CREATE INDEX IF NOT EXISTS goods_receipts_org_status_idx ON goods_receipts(org_id, status);
CREATE INDEX IF NOT EXISTS goods_receipts_org_created_idx ON goods_receipts(org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS goods_receipt_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goods_receipt_id UUID NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  purchase_draft_item_id UUID NOT NULL REFERENCES purchase_draft_items(id),
  product_id UUID NOT NULL REFERENCES products(id),
  quantity_received INTEGER NOT NULL,
  quantity_damaged INTEGER NOT NULL DEFAULT 0,
  notes VARCHAR(500),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT goods_receipt_items_qty_received_chk CHECK (quantity_received > 0),
  CONSTRAINT goods_receipt_items_qty_damaged_chk CHECK (quantity_damaged >= 0)
);

CREATE INDEX IF NOT EXISTS goods_receipt_items_receipt_idx ON goods_receipt_items(goods_receipt_id);
CREATE INDEX IF NOT EXISTS goods_receipt_items_draft_item_idx ON goods_receipt_items(purchase_draft_item_id);
