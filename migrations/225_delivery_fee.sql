-- v1.2.1 delivery fee: a service charge on top of a delivery order.
--
-- organizations: the fee's name and the price one tap adds at the till, and
-- whether it earns commission (off by default). Admin set, every change logged.
--
-- orders.delivery_fee: what this order was charged for delivery, inside
-- `total` and VAT'd with the goods. NULL on every order from before it (no
-- fee), so no backfill. Never negative.
--
-- Idempotent: re-applied on every deploy.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS delivery_fee_name varchar(60) NOT NULL DEFAULT 'Delivery fee';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS delivery_fee_price numeric(10,2) NOT NULL DEFAULT 3.00;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS delivery_fee_commissionable boolean NOT NULL DEFAULT false;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee numeric(10,2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_delivery_fee_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_delivery_fee_check CHECK (delivery_fee IS NULL OR delivery_fee >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_delivery_fee_price_check') THEN
    ALTER TABLE organizations ADD CONSTRAINT organizations_delivery_fee_price_check CHECK (delivery_fee_price >= 0);
  END IF;
END $$;
