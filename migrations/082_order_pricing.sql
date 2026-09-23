-- v1.2 Phase 1B: what a sale was charged, and why.
--
-- One priceOrder() (shared/pricing/priceOrder.ts) prices every till sale on
-- the server before any payment leg is written. The order keeps each step of
-- that price so the shift report can show discounts, a receipt can show VAT,
-- and a later question ("why was this £45?") has an answer:
--   subtotal − tier_discount − promo_discount + vat_amount − points_discount = total
-- All NULL on orders placed before this release: their breakdown was never
-- recorded, and 0 would claim a fact nobody knows.
-- Idempotent: re-applied on every deploy.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal numeric(10,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tier_discount numeric(10,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tier_discount_percent numeric(5,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promotion_id uuid;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_code varchar(50);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_discount numeric(10,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS points_redeemed integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS points_discount numeric(10,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS vat_rate numeric(5,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS vat_amount numeric(10,2);

-- Promotion usage reports read orders by promotion.
CREATE INDEX IF NOT EXISTS orders_promotion_idx
  ON orders (org_id, promotion_id)
  WHERE promotion_id IS NOT NULL;
