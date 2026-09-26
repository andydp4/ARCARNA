-- A business that is not VAT-registered must not charge VAT, so a new
-- organisation starts at 0% until it sets its own rate (Settings → Invoice).
-- Existing organisations keep whatever rate they already have.
ALTER TABLE organizations ALTER COLUMN default_tax_rate SET DEFAULT 0.00;
