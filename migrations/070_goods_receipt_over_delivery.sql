-- A manager's "yes, the supplier really sent more than we ordered", recorded
-- per receipt LINE and acted on only when the receipt is COMPLETED.
--
-- The first version of over-delivery (in the same release) raised the
-- purchase line's ordered quantity the moment the PENDING receipt was
-- created. Voiding that receipt never lowered it again, so a typo (400 for
-- 40) left the order permanently inflated, the draft unable to reach
-- fully_received, and replenishment seeing phantom stock "on order". Now the
-- acceptance travels with the receipt line and completeGoodsReceipt raises the
-- ordered quantity under the same row lock that books the stock in; a voided
-- receipt changes nothing. Idempotent: re-applied on every deploy.
ALTER TABLE goods_receipt_items
  ADD COLUMN IF NOT EXISTS over_delivery_accepted boolean NOT NULL DEFAULT false;
