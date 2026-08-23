-- WM Supplies website foundation.
-- Additive migration only: backend-managed theme, blocks, media, order settings,
-- and public product metadata for the customer-facing renderer.

CREATE TABLE IF NOT EXISTS website_uploaded_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider varchar(32) NOT NULL DEFAULT 'local',
  storage_key varchar(1024),
  public_url varchar(2048) NOT NULL,
  file_name varchar(255) NOT NULL,
  original_file_name varchar(255),
  mime_type varchar(128) NOT NULL,
  byte_size integer NOT NULL,
  width integer,
  height integer,
  alt_text varchar(255),
  status varchar(32) NOT NULL DEFAULT 'available',
  uploaded_by varchar(255) REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'website_uploaded_files_provider_ck'
  ) THEN
    ALTER TABLE website_uploaded_files
      ADD CONSTRAINT website_uploaded_files_provider_ck
      CHECK (provider IN ('local', 'r2'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'website_uploaded_files_status_ck'
  ) THEN
    ALTER TABLE website_uploaded_files
      ADD CONSTRAINT website_uploaded_files_status_ck
      CHECK (status IN ('available', 'pending', 'deleted'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'website_uploaded_files_byte_size_ck'
  ) THEN
    ALTER TABLE website_uploaded_files
      ADD CONSTRAINT website_uploaded_files_byte_size_ck
      CHECK (byte_size > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS website_uploaded_files_org_status_idx
  ON website_uploaded_files(org_id, status);
CREATE INDEX IF NOT EXISTS website_uploaded_files_org_created_idx
  ON website_uploaded_files(org_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS website_uploaded_files_provider_storage_key_uq
  ON website_uploaded_files(provider, storage_key)
  WHERE storage_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS website_theme_settings (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  site_name varchar(255) NOT NULL DEFAULT 'WM Supplies',
  logo_file_id uuid REFERENCES website_uploaded_files(id) ON DELETE SET NULL,
  favicon_file_id uuid REFERENCES website_uploaded_files(id) ON DELETE SET NULL,
  primary_color varchar(16) NOT NULL DEFAULT '#ff2bd6',
  secondary_color varchar(16) NOT NULL DEFAULT '#00d4ff',
  accent_color varchar(16) NOT NULL DEFAULT '#ffe600',
  background_color varchar(16) NOT NULL DEFAULT '#111111',
  text_color varchar(16) NOT NULL DEFAULT '#ffffff',
  border_color varchar(16) NOT NULL DEFAULT '#ffffff',
  button_background_color varchar(16) NOT NULL DEFAULT '#ffe600',
  button_text_color varchar(16) NOT NULL DEFAULT '#111111',
  heading_font varchar(120),
  body_font varchar(120),
  custom_css text,
  updated_by varchar(255) REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS website_order_settings (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  order_access_mode varchar(32) NOT NULL DEFAULT 'public',
  default_order_status varchar(20) NOT NULL DEFAULT 'pending',
  default_location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  allow_out_of_stock_orders boolean NOT NULL DEFAULT false,
  min_order_value numeric(10, 2),
  order_intro_text text,
  success_message text,
  notification_email varchar(255),
  updated_by varchar(255) REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamp DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'website_order_settings_access_mode_ck'
  ) THEN
    ALTER TABLE website_order_settings
      ADD CONSTRAINT website_order_settings_access_mode_ck
      CHECK (order_access_mode IN ('public', 'password', 'clerk'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'website_order_settings_status_ck'
  ) THEN
    ALTER TABLE website_order_settings
      ADD CONSTRAINT website_order_settings_status_ck
      CHECK (default_order_status IN ('pending', 'on-hold', 'awaiting-customer', 'urgent', 'completed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'website_order_settings_min_order_value_ck'
  ) THEN
    ALTER TABLE website_order_settings
      ADD CONSTRAINT website_order_settings_min_order_value_ck
      CHECK (min_order_value IS NULL OR min_order_value >= 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS website_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  page varchar(64) NOT NULL DEFAULT 'home',
  type varchar(32) NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true,
  title varchar(255),
  subtitle varchar(255),
  body text,
  cta_label varchar(120),
  cta_link varchar(2048),
  image_file_id uuid REFERENCES website_uploaded_files(id) ON DELETE SET NULL,
  background_color varchar(16),
  text_color varchar(16),
  border_color varchar(16),
  button_background_color varchar(16),
  button_text_color varchar(16),
  overlay_color varchar(16),
  overlay_opacity numeric(4, 3) NOT NULL DEFAULT 0,
  image_fit varchar(16) NOT NULL DEFAULT 'cover',
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by varchar(255) REFERENCES users(id) ON DELETE SET NULL,
  updated_by varchar(255) REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'website_blocks_type_ck'
  ) THEN
    ALTER TABLE website_blocks
      ADD CONSTRAINT website_blocks_type_ck
      CHECK (type IN ('hero', 'image', 'wide', 'split', 'cta', 'notice', 'gallery', 'spacer'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'website_blocks_overlay_opacity_ck'
  ) THEN
    ALTER TABLE website_blocks
      ADD CONSTRAINT website_blocks_overlay_opacity_ck
      CHECK (overlay_opacity >= 0 AND overlay_opacity <= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'website_blocks_image_fit_ck'
  ) THEN
    ALTER TABLE website_blocks
      ADD CONSTRAINT website_blocks_image_fit_ck
      CHECK (image_fit IN ('cover', 'contain', 'fill'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS website_blocks_org_page_sort_idx
  ON website_blocks(org_id, page, sort_order);
CREATE INDEX IF NOT EXISTS website_blocks_org_visible_idx
  ON website_blocks(org_id, is_visible);
CREATE INDEX IF NOT EXISTS website_blocks_image_file_idx
  ON website_blocks(image_file_id);

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS available_for_website boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS website_title varchar(255),
  ADD COLUMN IF NOT EXISTS website_description text,
  ADD COLUMN IF NOT EXISTS website_category varchar(120),
  ADD COLUMN IF NOT EXISTS website_unit_label varchar(120),
  ADD COLUMN IF NOT EXISTS website_sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS website_image_file_id uuid REFERENCES website_uploaded_files(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS products_org_website_idx
  ON products(org_id, available_for_website, website_sort_order);
CREATE INDEX IF NOT EXISTS products_website_image_file_idx
  ON products(website_image_file_id);

INSERT INTO website_theme_settings (org_id, site_name)
SELECT id, COALESCE(NULLIF(trading_name, ''), name, 'WM Supplies')
FROM organizations
ON CONFLICT (org_id) DO NOTHING;

INSERT INTO website_order_settings (org_id)
SELECT id
FROM organizations
ON CONFLICT (org_id) DO NOTHING;
