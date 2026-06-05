-- WhatsApp Phase 2 — customer source, product aliases, order intents (idempotent).

ALTER TABLE customers ADD COLUMN IF NOT EXISTS source varchar(32);
ALTER TABLE products ADD COLUMN IF NOT EXISTS aliases jsonb;

CREATE TABLE IF NOT EXISTS whatsapp_order_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  message_id uuid REFERENCES whatsapp_messages(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  parsed_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_text text,
  confidence_score numeric(4,3),
  status varchar(16) NOT NULL DEFAULT 'suggested',
  draft_order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_order_intents_org_idx ON whatsapp_order_intents (org_id);
CREATE INDEX IF NOT EXISTS whatsapp_order_intents_conversation_idx
  ON whatsapp_order_intents (conversation_id);
CREATE INDEX IF NOT EXISTS whatsapp_order_intents_status_idx
  ON whatsapp_order_intents (org_id, status);
