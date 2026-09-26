-- v1.2 Phase 7C: benefit, speed, targets and people.
-- Re-applied on every deploy, so every statement is idempotent.

-- 1. Satisfaction stars, fixed (STF-11): one per order, with who rated it and
--    where. Duplicates are cleaned BEFORE the one-per-order rule goes on, or
--    the unique index would refuse to build. The most recent rating on an
--    order is kept: a second tap was the person correcting the first.
ALTER TABLE satisfaction_scores ADD COLUMN IF NOT EXISTS rated_by_user_id varchar(255);
-- Rows from before this were not recorded with a source: 'unknown', not a guess.
ALTER TABLE satisfaction_scores ADD COLUMN IF NOT EXISTS source varchar(16) NOT NULL DEFAULT 'unknown';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'satisfaction_scores_source_check') THEN
    ALTER TABLE satisfaction_scores
      ADD CONSTRAINT satisfaction_scores_source_check
      CHECK (source IN ('board', 'capture', 'customer', 'unknown'));
  END IF;
END $$;

-- Before dropping the older duplicates, carry the latest follow-up (and a
-- comment, if the kept row has none) onto the row being kept, so a low score
-- that was already handled does not come back into the follow-up queue.
-- A no-op once duplicates are gone.
WITH ranked AS (
  SELECT id, order_id,
         row_number() OVER (PARTITION BY order_id ORDER BY score_date DESC, id DESC) AS rn
    FROM satisfaction_scores
   WHERE order_id IS NOT NULL
),
merged AS (
  SELECT order_id,
         max(followed_up_at) AS followed_up_at,
         (array_agg(comment ORDER BY score_date DESC, id DESC) FILTER (WHERE comment IS NOT NULL))[1] AS comment
    FROM satisfaction_scores
   WHERE order_id IS NOT NULL
   GROUP BY order_id
  HAVING count(*) > 1
)
UPDATE satisfaction_scores s
   SET followed_up_at = coalesce(s.followed_up_at, m.followed_up_at),
       comment = coalesce(s.comment, m.comment)
  FROM ranked r
  JOIN merged m ON m.order_id = r.order_id
 WHERE r.rn = 1
   AND s.id = r.id
   AND ((s.followed_up_at IS NULL AND m.followed_up_at IS NOT NULL)
        OR (s.comment IS NULL AND m.comment IS NOT NULL));

DELETE FROM satisfaction_scores s
 USING satisfaction_scores t
 WHERE s.order_id IS NOT NULL
   AND s.order_id = t.order_id
   AND (s.score_date, s.id) < (t.score_date, t.id);

CREATE UNIQUE INDEX IF NOT EXISTS satisfaction_scores_order_uq
  ON satisfaction_scores (order_id) WHERE order_id IS NOT NULL;

-- 2. Staff targets (STF-07): admins only, logged and versioned. Each change
--    is a new row with the next version; a row is never edited, so a colour
--    shown last month can always be explained by the targets in force then.
CREATE TABLE IF NOT EXISTS staff_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version integer NOT NULL,
  targets jsonb NOT NULL,
  note text,
  set_by_user_id varchar(255) NOT NULL,
  set_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_targets_org_version_uq ON staff_targets (org_id, version);

CREATE OR REPLACE FUNCTION staff_targets_no_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'staff_targets rows are versions: write a new one instead of editing';
END
$$;

DROP TRIGGER IF EXISTS staff_targets_no_update_trg ON staff_targets;
CREATE TRIGGER staff_targets_no_update_trg
  BEFORE UPDATE ON staff_targets
  FOR EACH ROW EXECUTE FUNCTION staff_targets_no_update();

-- 3. Loss-prevention flags (STF-09) go into Needs a look as a third kind.
--    Their source id is derived from (org, person, measure, week), so a
--    re-run of the weekly job cannot raise the same flag twice.
ALTER TABLE exception_reviews DROP CONSTRAINT IF EXISTS exception_reviews_kind_check;
ALTER TABLE exception_reviews
  ADD CONSTRAINT exception_reviews_kind_check CHECK (kind IN ('price', 'refund', 'pattern'));

-- 4. The weekly staff job (loss-prevention flags + digest) runs once per org
--    per week, after Monday's 06:00 close. This row is the exactly-once key
--    and holds counts only: the digest is built per recipient at send time
--    and no named figure is ever stored.
CREATE TABLE IF NOT EXISTS staff_weekly_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  ran_at timestamp NOT NULL DEFAULT now(),
  flags_raised integer NOT NULL DEFAULT 0,
  digests_sent integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_weekly_runs_org_week_uq ON staff_weekly_runs (org_id, week_start);
