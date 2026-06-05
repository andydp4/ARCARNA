-- WhatsApp Phase 3 — message templates (idempotent).

CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  template_name varchar(128) NOT NULL,
  category varchar(48),
  language varchar(16) NOT NULL DEFAULT 'en_GB',
  status varchar(24) NOT NULL DEFAULT 'LOCAL',
  body text,
  variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_templates_org_idx ON whatsapp_templates (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_templates_org_name_lang_idx
  ON whatsapp_templates (org_id, template_name, language);
