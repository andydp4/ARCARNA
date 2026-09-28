-- v1.2.2: label template settings (Settings → Labels) — which label types
-- "Print labels" prints, which details go on each, and auto-print after
-- payment. NULL means "never changed": the app reads it through
-- normalizeLabelSettings (shared/labelSettings.ts), whose defaults are what
-- the labels printed before this setting existed.
--
-- Idempotent: re-applied on every deploy.

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS label_settings jsonb;
