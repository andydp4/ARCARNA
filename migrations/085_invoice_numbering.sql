-- v1.2 Phase 1C: invoices are numbered, carry your terms, and keep who they
-- were made out to.
--
-- Invoices used to be written for every till sale with a random suffix
-- (INV-20260923-K3QZ). A till sale now gets a receipt; an invoice is issued
-- when a sale goes on a tab, or when a customer asks for one. Each new one
-- takes the organisation's next number (invoice_start_number, then +1), the
-- payment terms in force that day, and the customer's name as it was — so a
-- later rename does not rewrite an invoice already sent.
--
-- invoice_last_number is the counter: NULL until the first numbered invoice.
-- Existing invoice rows keep sequence_number NULL; they are not renumbered.
-- Idempotent: re-applied on every deploy.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS invoice_last_number integer;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sequence_number integer;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_terms varchar(255);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_name varchar(255);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS vat_rate numeric(5,2);

-- One number per organisation, and one numbered invoice per order.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_org_sequence_uq
  ON invoices (org_id, sequence_number)
  WHERE sequence_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_order_numbered_uq
  ON invoices (order_id)
  WHERE sequence_number IS NOT NULL;
