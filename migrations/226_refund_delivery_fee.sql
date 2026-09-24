-- v1.2.1 delivery fee: a refund can give the delivery fee back.
--
-- refunds.delivery_fee: the part of this refund that was the order's delivery
-- fee, as charged (VAT included), inside `total`. NULL on every refund of
-- goods only, and on every refund from before it. An order's fee is refunded
-- at most once. Delivery fee takings net it off on the day it was issued.
--
-- Idempotent: re-applied on every deploy.
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS delivery_fee numeric(10,2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refunds_delivery_fee_check') THEN
    ALTER TABLE refunds ADD CONSTRAINT refunds_delivery_fee_check CHECK (delivery_fee IS NULL OR delivery_fee >= 0);
  END IF;
END $$;
