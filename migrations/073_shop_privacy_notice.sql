-- Phase 0B (PRV-15): the shop's customer privacy notice and data protection
-- complaints contact. The owner writes the wording, so every column starts
-- empty and the shop site / receipts hide the links until they are filled.
-- Idempotent: re-applied on every deploy.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS privacy_notice_url varchar(1024);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS privacy_notice_text text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS complaints_contact_name varchar(255);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS complaints_contact_email varchar(255);
