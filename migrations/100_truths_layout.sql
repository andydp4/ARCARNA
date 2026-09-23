-- Truths at a glance (v1.2 Phase 3): one widget layout per org, set by
-- admins through PUT /api/truths/layout (logged in admin_audit_logs). No row
-- means the default layout (today's Truths Hub charts). The widget list is
-- validated against the catalogue in shared/truthsLayout.ts before it is
-- written, so the column holds only ids, sizes and windows the app knows.
-- Re-applied on every deploy, so idempotent.
CREATE TABLE IF NOT EXISTS org_truths_layouts (
  org_id uuid PRIMARY KEY,
  widgets jsonb NOT NULL,
  updated_by varchar(255),
  updated_at timestamp NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_truths_layouts_org_id_organizations_id_fk'
  ) THEN
    ALTER TABLE org_truths_layouts
      ADD CONSTRAINT org_truths_layouts_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
END $$;
