-- Signals: who each one is for, and read state per person (v1.2 Phase 0B,
-- FIX-08 / CMP-01).
--
-- Until now a Signal was one org-wide row with one read flag: every member of
-- staff, cashiers included, saw every Signal (commission paid, personal use
-- naming a colleague), and whoever cleared it first cleared it for everyone.
--
-- Now `notify()` (server/services/signals.ts) resolves the recipients when it
-- writes the Signal and records one row per person. The recipient lookup
-- always includes SUPER_ADMIN accounts: their allowed_users.org_id is NULL by
-- design, so a plain "org_id = this org" query skipped the owner, and an
-- admin-only Signal could reach nobody.
--
-- Re-applied on every deploy, so idempotent.

ALTER TABLE org_notifications ADD COLUMN IF NOT EXISTS audience jsonb;
ALTER TABLE org_notifications ADD COLUMN IF NOT EXISTS subject_user_id varchar(255);

CREATE TABLE IF NOT EXISTS org_notification_recipients (
  notification_id uuid NOT NULL REFERENCES org_notifications(id) ON DELETE CASCADE,
  user_id varchar(255) NOT NULL,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  read_at timestamp,
  dismissed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  -- Named as drizzle names it, so db:push and this file build the same schema.
  CONSTRAINT org_notification_recipients_notification_id_user_id_pk PRIMARY KEY (notification_id, user_id)
);

CREATE INDEX IF NOT EXISTS org_notification_recipients_user_idx
  ON org_notification_recipients (org_id, user_id);

-- Backfill Signals written before this migration (audience IS NULL), with the
-- routing the owner signed off: commission paid goes to admins, everything
-- else that existed goes to managers. The old org-wide read flag is carried
-- onto each person so nothing already read comes back as unread.
INSERT INTO org_notification_recipients (notification_id, user_id, org_id, read_at)
SELECT n.id, COALESCE(a.auth_user_id, a.replit_user_id), n.org_id, n.read_at
FROM org_notifications n
JOIN allowed_users a ON (
  a.role = 'SUPER_ADMIN'
  OR a.is_owner = 1
  OR (
    a.org_id = n.org_id
    AND (
      a.role = 'ADMIN'
      OR (n.source <> 'cashier_commission' AND a.role = 'MANAGER')
    )
  )
)
WHERE n.audience IS NULL
ON CONFLICT DO NOTHING;

UPDATE org_notifications
SET audience = jsonb_build_object(
  'minRole',
  CASE WHEN source = 'cashier_commission' THEN 'ADMIN' ELSE 'MANAGER' END
)
WHERE audience IS NULL;
