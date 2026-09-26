-- v1.2.1: who logged an order expense, so the owner can actually audit the
-- list rather than trust an unattributed total (there was previously no
-- screen at all listing individual order expenses).
--
-- Idempotent: re-applied on every deploy.
ALTER TABLE order_expenses ADD COLUMN IF NOT EXISTS added_by_user_id varchar(255);
