-- v1.2 Stripe links: a closed cashier shift keeps card taken by Stripe link
-- apart from card taken on the terminal, so each reconciles against its own
-- statement. Shifts closed before this read 0 (any card link was then counted
-- nowhere, because none existed).
-- Idempotent: re-applied on every deploy.
ALTER TABLE cashier_shift_summaries ADD COLUMN IF NOT EXISTS card_link_sales numeric(12,2) NOT NULL DEFAULT '0';
