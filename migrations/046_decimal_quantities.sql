-- Decimal quantities across the stock ledger.
--
-- Every quantity in the system was `integer`, so a shop could not sell 0.4 of
-- anything: the POS input parsed with parseInt, and the row vanished. Anyone
-- selling by weight or length — deli, produce, fabric, cable, timber — could
-- not use the till for their actual catalogue.
--
-- integer -> numeric(14,3) is a widening conversion: every existing value is
-- representable exactly, nothing is truncated, and the change is reversible for
-- any row whose value is still whole (see the rollback note at the foot).
--
-- Scale 3 is a deliberate choice. Two decimals cannot express a third of a
-- kilo; four buys precision no scale prints. Three matches how weight is
-- actually recorded on retail scales (grams, millilitres).
--
-- Locking: ALTER TYPE on an integer column rewrites the table and holds an
-- ACCESS EXCLUSIVE lock for the duration. On a single-shop dataset this is
-- sub-second; on a large inventory_movements history it is the one statement
-- here worth running in a maintenance window. It is deliberately not wrapped in
-- a single transaction spanning all tables, so a failure part-way leaves the
-- remaining tables untouched rather than holding every lock at once.

-- Stock on hand ------------------------------------------------------------
ALTER TABLE products
  ALTER COLUMN stock TYPE numeric(14,3),
  ALTER COLUMN stock_limit TYPE numeric(14,3);

ALTER TABLE product_location_stock
  ALTER COLUMN stock TYPE numeric(14,3),
  ALTER COLUMN stock_limit TYPE numeric(14,3);

-- What was sold ------------------------------------------------------------
ALTER TABLE order_items
  ALTER COLUMN quantity TYPE numeric(14,3);

-- The audit trail. delta/previous_stock/new_stock must move with stock itself,
-- or a fractional sale reconciles against a rounded ledger.
ALTER TABLE inventory_movements
  ALTER COLUMN delta TYPE numeric(14,3),
  ALTER COLUMN previous_stock TYPE numeric(14,3),
  ALTER COLUMN new_stock TYPE numeric(14,3);

-- Purchasing and receiving -------------------------------------------------
ALTER TABLE purchase_draft_items
  ALTER COLUMN quantity TYPE numeric(14,3),
  ALTER COLUMN quantity_received TYPE numeric(14,3);

ALTER TABLE goods_receipt_items
  ALTER COLUMN quantity_received TYPE numeric(14,3),
  ALTER COLUMN quantity_damaged TYPE numeric(14,3);

-- Transfers between sites --------------------------------------------------
ALTER TABLE inventory_transfer_items
  ALTER COLUMN quantity TYPE numeric(14,3);

-- Rollback
-- --------
-- Reverting is only lossless while every value is whole. Check first:
--
--   SELECT count(*) FROM product_location_stock WHERE stock <> trunc(stock);
--   SELECT count(*) FROM order_items            WHERE quantity <> trunc(quantity);
--   SELECT count(*) FROM inventory_movements    WHERE delta <> trunc(delta);
--
-- If those are all zero, `ALTER COLUMN ... TYPE integer` restores the previous
-- shape. If any are non-zero, a fractional quantity has been recorded and
-- reverting would silently round real stock and real sales — restore from
-- backup instead.
