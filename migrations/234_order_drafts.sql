-- An unfinished order kept on the server, for the person who started it.
-- Saving a row here does not take payment, move stock, or issue an invoice.
-- Idempotent.

CREATE TABLE IF NOT EXISTS order_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id varchar(255) NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  status varchar(16) NOT NULL DEFAULT 'open',
  label varchar(120) NOT NULL DEFAULT 'Draft',
  payload jsonb NOT NULL,
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT order_drafts_status_check CHECK (status IN ('open', 'submitted', 'discarded'))
);

CREATE INDEX IF NOT EXISTS order_drafts_owner_idx ON order_drafts (org_id, user_id, status);
