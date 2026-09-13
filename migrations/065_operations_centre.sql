-- The Operations Centre: order stages, the event log, stations and org settings.
--
-- Architectural principle: stages are TIMESTAMPS, not statuses. `completed` is
-- and stays the only settling status — money (settled_total, settled_at,
-- completed_user_id, the commission split and the credit leg) keys on
-- `status = 'completed'` alone. Adding `ready` or `delivered` as statuses would
-- have put a second, silent gate in front of every one of those, so "ready",
-- "customer arrived" and "out for delivery" are stamps on the row instead, each
-- mirrored by an `order_events` row written in the same transaction. See
-- docs/briefs/PHASE_N_OPERATIONS_CENTRE.md § "Decisions locked".
--
-- This file is RE-APPLIED ON EVERY DEPLOY. scripts/apply-migrations-pm2.sh
-- globs migrations/*.sql and runs every one of them with ON_ERROR_STOP=0, so
-- "run once" is not a property any statement here may assume. Every DDL
-- statement is IF NOT EXISTS, and the one data statement — the ready_at
-- backfill — is a single CTE whose UPDATE is its own guard: the second run
-- matches no rows, so it RETURNS none, so the INSERT it feeds writes none.
-- A plain `UPDATE …; INSERT …;` pair would have fabricated a duplicate 'ready'
-- event on every release, which is precisely the shape of bug that made 058's
-- silent half-apply worth this much comment (see the script's own header).
--
-- NOT wrapped in a transaction: CREATE INDEX CONCURRENTLY cannot run inside
-- one, and psql -f is autocommit per statement, which is what the deploy uses.
--
-- User ids are varchar(255) with no foreign key, for migration 057's reason:
-- removing somebody from the org must not make historic orders unreadable.

-- ---------------------------------------------------------------------------
-- 1. order_events — the timeline, written once per stage, never updated.
-- ---------------------------------------------------------------------------
-- Every stamp on `orders` answers "when"; this table answers "who, and what
-- did they say about it", and it outlives the order: a `deleted` event carries
-- the customer, total and status of a row that no longer exists, which is why
-- `order_id` deliberately has NO foreign key while `org_id` does (tenancy is
-- not negotiable; referential tidiness on a deleted order is).
CREATE TABLE IF NOT EXISTS order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id uuid NOT NULL,                      -- no FK: 'deleted' rows outlive the order
  kind varchar(32) NOT NULL,
  at timestamp NOT NULL DEFAULT now(),         -- naive UTC, like every other timestamp here
  user_id varchar(255),                        -- actor; NULL = system / web
  meta jsonb
);

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='order_events_kind_check') THEN
  ALTER TABLE order_events ADD CONSTRAINT order_events_kind_check CHECK (kind IN
   ('received','assigned','unassigned','ready','unready','arrived','out_for_delivery','held','unheld',
    'delayed','delay_cleared','due_set','completed','reopened','status_changed','deleted'));
END IF; END $$;

-- One index per question actually asked: a card's own timeline, the Issues and
-- Delay reports (by kind over a trading day), and "what did this person do".
CREATE INDEX IF NOT EXISTS order_events_order_idx ON order_events (org_id, order_id, at);
CREATE INDEX IF NOT EXISTS order_events_kind_idx  ON order_events (org_id, kind, at);
CREATE INDEX IF NOT EXISTS order_events_actor_idx ON order_events (org_id, user_id, at);

-- ---------------------------------------------------------------------------
-- 2. orders — who is dealing with it, and the stage stamps.
-- ---------------------------------------------------------------------------
-- assigned_user_id is the auth subject (req.user.id), the same string
-- input_user_id and completed_user_id hold. It is NOT a commission column and
-- must never be written into one: whoever taps Handed over / Delivered earns
-- the 90% (Phase L), and an assignee who does not complete earns nothing.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS assigned_user_id varchar(255),
  ADD COLUMN IF NOT EXISTS assigned_at timestamp,
  ADD COLUMN IF NOT EXISTS assigned_by_user_id varchar(255),
  ADD COLUMN IF NOT EXISTS held_at timestamp,
  ADD COLUMN IF NOT EXISTS ready_at timestamp,
  ADD COLUMN IF NOT EXISTS customer_arrived_at timestamp,
  ADD COLUMN IF NOT EXISTS out_for_delivery_at timestamp;

-- queue_position goes, it is not carried forward. It was the Order Status
-- Dashboard's manual sort key (migration 043); the board sorts by due time and
-- state instead, ARC-T1-003 retires with it, and nothing reads or writes it
-- afterwards. Old, replaced things get removed in the change that replaces
-- them rather than accumulating as columns nobody dares delete.
ALTER TABLE orders DROP COLUMN IF EXISTS queue_position;

-- Partial indexes only — no expression indexes, so drizzle-kit push round-trips
-- them and scripts/audit-schema-push-drift.mjs stays clean. Every one of these
-- is the board's own read: open orders by assignee, by promise, and the
-- no-promise tail it sorts by arrival instead.
CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_assigned_open_idx ON orders (org_id, assigned_user_id) WHERE status <> 'completed';
CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_eta_open_idx      ON orders (org_id, eta_given)   WHERE status <> 'completed';
CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_revised_open_idx  ON orders (org_id, revised_eta) WHERE status <> 'completed';
CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_nodue_open_idx    ON orders (org_id, entered_at)  WHERE status <> 'completed' AND eta_given IS NULL AND revised_eta IS NULL;
-- The "Done today" tray reads the last 120 minutes of settlements.
CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_settled_recent_idx ON orders (org_id, settled_at);

-- ---------------------------------------------------------------------------
-- 3. ready_at backfill — one shot by construction.
-- ---------------------------------------------------------------------------
-- 'awaiting-customer' has meant "ready" in the old list, so those rows get a
-- ready_at rather than appearing on the board as never-prepared. The time is a
-- guess (updated_at, else created_at), so the event carries {"assumed":true}
-- and the timing report excludes it — a report that quietly averaged in made-up
-- numbers would be worse than one with a gap in it.
--
-- Idempotency has TWO guards, and both are load-bearing under re-application:
--   ready_at IS NULL    — the row has not been backfilled;
--   NOT EXISTS(…'ready')— no 'ready' event exists for it, so a row whose
--                         ready_at was later cleared by `unready` (which leaves
--                         its events behind) is not silently re-stamped and
--                         re-evented on the next deploy.
-- The INSERT reads only from the UPDATE's RETURNING, so no rows updated means
-- no rows inserted. Verified by applying this file twice and comparing
-- count(*) FROM order_events (N2's DoD).
WITH backfilled AS (
  UPDATE orders o SET ready_at = COALESCE(o.updated_at, o.created_at)
  WHERE o.ready_at IS NULL AND o.status = 'awaiting-customer'
    AND NOT EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.id AND e.kind = 'ready')
  RETURNING o.id, o.org_id, o.ready_at)
INSERT INTO order_events (org_id, order_id, kind, at, user_id, meta)
SELECT org_id, id, 'ready', ready_at, NULL, '{"assumed":true}'::jsonb FROM backfilled;

-- ---------------------------------------------------------------------------
-- 4. ops_staff — which area a person works, and whether they are about.
-- ---------------------------------------------------------------------------
-- Sticky per person, not per device and not per day: alerts are addressed to
-- people, and a tablet shared by three cashiers must not decide who gets them.
-- last_seen_at is written by the board's stream connection (throttled to one
-- write per org:user per 60s) and is what "present" means — recipients of a
-- station alert are the members seen in the last 15 minutes, everyone on the
-- station if nobody has been.
CREATE TABLE IF NOT EXISTS ops_staff (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id varchar(255) NOT NULL,
  station varchar(16) CHECK (station IS NULL OR station IN ('collection','delivery','both')),
  station_set_at timestamp,
  last_seen_at timestamp,
  on_break boolean NOT NULL DEFAULT false,
  -- Named, not anonymous: `drizzle-kit push` builds this table as
  -- ops_staff_org_id_user_id_pk and a migration-built one would land on the
  -- default ops_staff_pkey, which is schema drift between a fresh database and
  -- a deployed one — integrityMigration.test.ts diffs exactly that and says so.
  CONSTRAINT ops_staff_org_id_user_id_pk PRIMARY KEY (org_id, user_id)
);

-- ---------------------------------------------------------------------------
-- 5. organizations — the board's timing policy.
-- ---------------------------------------------------------------------------
-- Defaults are the owner's answers (2026-09-12, Q5 and Q4): prep 20 min,
-- delivery lead 45, due-soon lead 10, late grace 5, and no alerts on orders
-- with no promised time (ops_alert_on_sla_due false) — an alert the shop did
-- not promise anybody is noise, and noise is how a board stops being read.
-- ops_auto_claim_on_create defaults ON: a till order with nobody's name on it
-- is the case the default-owner rule exists to remove.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS ops_prep_sla_minutes integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS ops_due_soon_lead_minutes integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS ops_late_grace_minutes integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS ops_delivery_lead_minutes integer NOT NULL DEFAULT 45,
  ADD COLUMN IF NOT EXISTS ops_auto_claim_on_create boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ops_reconcile_poll_seconds integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS ops_alert_on_sla_due boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ops_keep_screen_awake boolean NOT NULL DEFAULT true;

-- Order saved views retire in favour of the board's own filter (owner, Q15).
-- Safe to re-run: after the first pass there is nothing left to delete.
DELETE FROM saved_views WHERE page = 'orders';
