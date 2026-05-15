-- Phase 8: org setup profile, wizard state, import history
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS setup_complete integer NOT NULL DEFAULT 0;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS setup_wizard_state jsonb;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trading_name varchar(255);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS email varchar(255);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS phone varchar(50);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS address varchar(1024);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS vat_number varchar(50);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS company_number varchar(50);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS currency varchar(10) DEFAULT 'GBP';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS timezone varchar(64) DEFAULT 'Europe/London';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS business_type varchar(32);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS logo_url varchar(2048);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS invoice_template varchar(64) DEFAULT 'standard';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS invoice_prefix varchar(20) DEFAULT 'INV';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS invoice_start_number integer DEFAULT 1000;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS payment_terms varchar(255) DEFAULT 'Net 30';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS default_tax_rate numeric(5,2) DEFAULT 20.00;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS receipt_footer varchar(1024);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS receipt_style varchar(32) DEFAULT 'standard';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS accent_style varchar(32) DEFAULT 'midnight';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS business_colors jsonb;

CREATE TABLE IF NOT EXISTS import_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  import_type varchar(32) NOT NULL,
  file_name varchar(255),
  duplicate_mode varchar(32),
  imported_count integer DEFAULT 0,
  skipped_count integer DEFAULT 0,
  failed_count integer DEFAULT 0,
  failed_rows jsonb,
  created_by varchar(255),
  created_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS import_history_org_id_idx ON import_history(org_id);
