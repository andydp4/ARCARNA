-- U3: Saved filter views (idempotent)
CREATE TABLE IF NOT EXISTS saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar(255) NOT NULL,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  page varchar(32) NOT NULL,
  name varchar(120) NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}',
  sort jsonb NOT NULL DEFAULT '{}',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS saved_views_user_org_page_name_idx
  ON saved_views (user_id, org_id, page, name);

CREATE INDEX IF NOT EXISTS saved_views_user_org_page_idx
  ON saved_views (user_id, org_id, page);
