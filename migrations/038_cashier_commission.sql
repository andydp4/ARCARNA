-- Cashier profiles, cashier shifts, commission summaries & payments (idempotent)

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS receipt_logo_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS invoice_logo_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cashier_commission_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_cashier_commission_rate numeric(5, 2) DEFAULT 10.00,
  ADD COLUMN IF NOT EXISTS require_cashier_for_sale boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shift_inactivity_close_after varchar(16) DEFAULT 'never',
  ADD COLUMN IF NOT EXISTS global_expense_allocation_mode varchar(32) DEFAULT 'daily_percentage';

CREATE TABLE IF NOT EXISTS cashier_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cashier_code varchar(20) NOT NULL,
  display_name varchar(255) NOT NULL,
  pin_code varchar(16),
  default_commission_rate numeric(5, 2),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cashier_profiles_org_id_idx ON cashier_profiles (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS cashier_profiles_org_code_idx ON cashier_profiles (org_id, cashier_code);

CREATE TABLE IF NOT EXISTS cashier_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cashier_id uuid NOT NULL REFERENCES cashier_profiles(id),
  opened_by_user_id varchar(255) NOT NULL,
  closed_by_user_id varchar(255),
  opened_at timestamp NOT NULL DEFAULT now(),
  closed_at timestamp,
  last_activity_at timestamp NOT NULL DEFAULT now(),
  status varchar(16) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'auto_closed')),
  close_reason varchar(32),
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cashier_shifts_org_id_idx ON cashier_shifts (org_id);
CREATE INDEX IF NOT EXISTS cashier_shifts_cashier_id_idx ON cashier_shifts (cashier_id);
CREATE UNIQUE INDEX IF NOT EXISTS cashier_shifts_one_open_per_cashier_idx
  ON cashier_shifts (org_id, cashier_id)
  WHERE status = 'open';

CREATE TABLE IF NOT EXISTS cashier_shift_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES cashier_shifts(id) ON DELETE CASCADE,
  cashier_id uuid NOT NULL REFERENCES cashier_profiles(id),
  gross_sales numeric(12, 2) NOT NULL DEFAULT 0,
  cash_sales numeric(12, 2) NOT NULL DEFAULT 0,
  card_sales numeric(12, 2) NOT NULL DEFAULT 0,
  credit_sales numeric(12, 2) NOT NULL DEFAULT 0,
  unpaid_credit_sales numeric(12, 2) NOT NULL DEFAULT 0,
  stock_cost numeric(12, 2) NOT NULL DEFAULT 0,
  order_expenses numeric(12, 2) NOT NULL DEFAULT 0,
  global_expense_allocation numeric(12, 2) NOT NULL DEFAULT 0,
  refunds numeric(12, 2) NOT NULL DEFAULT 0,
  discounts numeric(12, 2) NOT NULL DEFAULT 0,
  net_sales_profit numeric(12, 2) NOT NULL DEFAULT 0,
  commission_rate numeric(5, 2) NOT NULL DEFAULT 0,
  commission_amount numeric(12, 2) NOT NULL DEFAULT 0,
  business_retained_profit numeric(12, 2) NOT NULL DEFAULT 0,
  has_incomplete_cost_data boolean NOT NULL DEFAULT false,
  closed_at timestamp NOT NULL,
  calculated_at timestamp NOT NULL DEFAULT now(),
  calculation_version integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS cashier_shift_summaries_org_id_idx ON cashier_shift_summaries (org_id);
CREATE INDEX IF NOT EXISTS cashier_shift_summaries_cashier_id_idx ON cashier_shift_summaries (cashier_id);
CREATE UNIQUE INDEX IF NOT EXISTS cashier_shift_summaries_shift_id_idx ON cashier_shift_summaries (shift_id);

CREATE TABLE IF NOT EXISTS cashier_commission_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cashier_id uuid NOT NULL REFERENCES cashier_profiles(id),
  shift_id uuid REFERENCES cashier_shifts(id),
  amount_paid numeric(12, 2) NOT NULL,
  paid_at timestamp NOT NULL DEFAULT now(),
  confirmed_by_user_id varchar(255) NOT NULL,
  notes text,
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cashier_commission_payments_org_id_idx ON cashier_commission_payments (org_id);
CREATE INDEX IF NOT EXISTS cashier_commission_payments_cashier_id_idx ON cashier_commission_payments (cashier_id);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS cashier_id uuid REFERENCES cashier_profiles(id),
  ADD COLUMN IF NOT EXISTS cashier_shift_id uuid REFERENCES cashier_shifts(id);

CREATE INDEX IF NOT EXISTS orders_cashier_shift_id_idx ON orders (cashier_shift_id);
