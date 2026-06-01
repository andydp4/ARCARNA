-- F1: Email receipt settings (idempotent)
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS receipt_email_opt_in boolean NOT NULL DEFAULT true;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS receipt_template_html text;
