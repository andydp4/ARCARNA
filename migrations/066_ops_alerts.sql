-- Personal Operations Centre alerts (Phase N, N5a).
--
-- One row per recipient, per incident: an `assigned` alert is addressed to
-- exactly the person who now has the order, `due_soon`/`late` are addressed
-- to the assignee (pulse only) or to a whole station (chime), and so on. This
-- is the fix for the org-wide, single-read-flag `org_notifications` the brief
-- (finding G7) calls out — a notification here belongs to one person and is
-- resolved the moment their colleague's action makes it stale, not merely
-- marked read.
--
-- Idempotent by construction: `ops_alerts_once_idx` is the ONLY thing standing
-- between a repeated sweep (or a re-run of this same transactional insert
-- after a server restart) and a duplicate row. Every writer inserts with
-- `ON CONFLICT (org_id, order_id, kind, user_id, due_key) DO NOTHING` rather
-- than checking existence first — see server/services/opsAlerts.ts.
--
-- This file is RE-APPLIED ON EVERY DEPLOY, the same rule 065 documents: every
-- statement is IF NOT EXISTS. Ordinary indexes (not CONCURRENTLY) — the table
-- is new and empty on every environment that runs this, so there is no lock
-- contention to avoid, unlike 065's indexes on the already-populous `orders`.
--
-- User ids are varchar(255) with no foreign key, migration 057's reason:
-- removing somebody from the org must not make a historic alert unreadable.
-- `order_id` also carries no foreign key, matching `order_events` (065): a
-- deleted order's alerts must still resolve (server/services/opsAlerts.ts's
-- sweep marks them `resolved_reason = 'deleted'`) rather than vanish with it.
CREATE TABLE IF NOT EXISTS ops_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id uuid NOT NULL,                      -- no FK: alerts must outlive a deleted order to resolve
  user_id varchar(255) NOT NULL,               -- always a person (station alerts are one row per member)
  station varchar(16) NOT NULL DEFAULT '',     -- provenance: '' = addressed personally
  kind varchar(24) NOT NULL,                   -- assigned|due_soon|late|customer_waiting|delayed|new_unassigned
  due_key varchar(32) NOT NULL DEFAULT '',     -- ISO of the promise the alert was computed from; a revision is a new cycle
  due_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  acked_at timestamp,
  acked_by_user_id varchar(255),
  resolved_at timestamp,
  resolved_by_user_id varchar(255),
  resolved_reason varchar(24)                  -- claimed|ready|completed|deleted|held|rolled_over|reassigned
);

-- The whole correctness contract in one index: one row per (order, kind,
-- recipient, cycle). Every writer relies on ON CONFLICT DO NOTHING against
-- exactly this — see server/services/opsAlerts.ts's module doc.
CREATE UNIQUE INDEX IF NOT EXISTS ops_alerts_once_idx ON ops_alerts (org_id, order_id, kind, user_id, due_key);

-- `listFor` (the board's `alerts` field) and the ack routes: one person's
-- still-open rows.
CREATE INDEX IF NOT EXISTS ops_alerts_open_idx ON ops_alerts (org_id, user_id) WHERE acked_at IS NULL AND resolved_at IS NULL;
