-- Per-org bank/payment details shown on generated invoice PDFs. Blank
-- fields mean that section is simply omitted from the invoice.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS invoice_bank_name varchar(255),
  ADD COLUMN IF NOT EXISTS invoice_bank_sort_code varchar(20),
  ADD COLUMN IF NOT EXISTS invoice_bank_account_number varchar(30),
  ADD COLUMN IF NOT EXISTS invoice_payment_link varchar(2048);
