-- WhatsApp Business integration — channel tables (idempotent).
-- Phase 1: accounts, conversations, messages, customer links.

CREATE TABLE IF NOT EXISTS whatsapp_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  phone_number varchar(32) NOT NULL,
  phone_number_id varchar(64) NOT NULL,
  business_account_id varchar(64),
  display_name varchar(255),
  status varchar(24) NOT NULL DEFAULT 'connected',
  last_webhook_at timestamp,
  last_outbound_at timestamp,
  last_outbound_status varchar(24),
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_accounts_org_idx ON whatsapp_accounts (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_accounts_phone_number_id_idx
  ON whatsapp_accounts (phone_number_id);

CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  whatsapp_account_id uuid NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  phone varchar(32) NOT NULL,
  wa_id varchar(32) NOT NULL,
  profile_name varchar(255),
  last_message_at timestamp,
  last_message_preview varchar(512),
  last_inbound_at timestamp,
  unread_count integer NOT NULL DEFAULT 0,
  status varchar(16) NOT NULL DEFAULT 'open',
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_conversations_org_idx ON whatsapp_conversations (org_id);
CREATE INDEX IF NOT EXISTS whatsapp_conversations_customer_idx ON whatsapp_conversations (customer_id);
CREATE INDEX IF NOT EXISTS whatsapp_conversations_last_message_idx
  ON whatsapp_conversations (org_id, last_message_at);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_conversations_account_wa_idx
  ON whatsapp_conversations (whatsapp_account_id, wa_id);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  whatsapp_message_id varchar(128),
  direction varchar(12) NOT NULL,
  message_type varchar(16) NOT NULL DEFAULT 'text',
  body text,
  media_id varchar(128),
  media_mime_type varchar(128),
  status varchar(16) NOT NULL DEFAULT 'received',
  raw_payload jsonb,
  sent_by_user_id varchar(255),
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_messages_conversation_idx
  ON whatsapp_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS whatsapp_messages_org_idx ON whatsapp_messages (org_id);
-- Idempotency: Meta message IDs are globally unique. Partial index allows many NULLs.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_wa_message_id_idx
  ON whatsapp_messages (whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS whatsapp_customer_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  linked_by_user_id varchar(255),
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_customer_links_org_idx ON whatsapp_customer_links (org_id);
CREATE INDEX IF NOT EXISTS whatsapp_customer_links_conversation_idx
  ON whatsapp_customer_links (conversation_id);
