-- Goods-receipt completion (and a few other call sites) build composite,
-- per-line idempotency keys for inventory_movements.event_id, e.g.
-- "goods_receipt_complete:<receipt-uuid>:<line-uuid>" (~95 chars). The
-- column was sized for a plain 36-char UUID, so every goods-receipt
-- completion failed with "value too long for type character varying(36)".
ALTER TABLE inventory_movements ALTER COLUMN event_id TYPE varchar(160);
