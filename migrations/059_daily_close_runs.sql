-- The 06:00 close. Each morning the previous trading day is totalled, its
-- shifts are closed, and the Signals go out.
--
-- One row per organisation per trading day, and the unique key is the whole
-- point: a server restarted at 06:00, or two instances running at once, must
-- not total the same day twice and send the same Signals twice. Whoever
-- inserts the row does the work; everybody else finds it already there and
-- stops.
CREATE TABLE IF NOT EXISTS daily_close_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  trading_day date NOT NULL,
  ran_at timestamp NOT NULL DEFAULT now(),
  shifts_closed integer NOT NULL DEFAULT 0,
  order_count integer NOT NULL DEFAULT 0,
  gross_sales numeric(12,2) NOT NULL DEFAULT '0',
  cash_sales numeric(12,2) NOT NULL DEFAULT '0',
  card_sales numeric(12,2) NOT NULL DEFAULT '0',
  credit_given numeric(12,2) NOT NULL DEFAULT '0',
  credit_resolved numeric(12,2) NOT NULL DEFAULT '0',
  personal_use_cost numeric(12,2) NOT NULL DEFAULT '0',
  commission_accrued numeric(12,2) NOT NULL DEFAULT '0',
  -- Drawers still open at the cut. They are NOT closed automatically: a cash
  -- drawer closed without being counted can never be reconciled afterwards, so
  -- the close names them and leaves them for a human to cash up.
  uncounted_drawers integer NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS daily_close_runs_org_day_idx
  ON daily_close_runs (org_id, trading_day);
