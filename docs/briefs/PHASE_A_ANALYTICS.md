# Phase A — Analytics & insights

**Status (2026-06-04):** **A1–A5 Done** on `main` ([`BRIEF_STATUS.md`](./BRIEF_STATUS.md))

Five briefs: **A1** daily KPI card, **A2** RFM customer segmentation, **A3** hour-of-day sales heatmap, **A4** stock turn ratio per category, **A5** promotion lift measurement.

All five sit on top of the existing `analytics_daily / weekly / monthly` tables (in schema). The aggregation pipeline is the existing event-driven worker layer (post-S2 — `event_outbox` + `server/workers/`). New routes serve pre-aggregated reads; pages render with Recharts (already a dep).

A1 first (highest-visibility owner win, single dashboard). A2–A5 can run in parallel with U-phase briefs.

---

## Brief A1 — Daily KPI card on dashboard

**Goal:** A compact card at the top of the dashboard showing today's sales, AOV, transaction count, with comparison to last week (same day) and to the same weekday last twelve months. Refreshes every 60 seconds.

**Touch:**

- `+ server/routes/analytics.ts` — `GET /api/analytics/kpi/daily?date=YYYY-MM-DD` (today by default); returns `{ today: {...}, lastWeek: {...}, sameWeekdayLtmAvg: {...} }`
- `+ shared/analytics/kpi.ts` — pure aggregators: `aggregateDay(orders) → { revenue, txns, aov, refundsTotal }`, `sameWeekdayWindow(date, weeks=52)`
- `~ shared/schema.ts` — no new table required; reads `analytics_daily` if present, falls back to live aggregation on `orders` (limited to org)
- `+ client/src/components/dashboard/DailyKpiCard.tsx` — three-column card (today / vs last week / vs same-weekday-LTM-avg); colour deltas (green up, red down)
- `~ client/src/pages/dashboard.tsx` — mount the card at the top
- `~ docs/PHASE_A_ANALYTICS.md` — referenced; no rewrite

**Steps:**

1. Server endpoint computes from `analytics_daily` when available (preferred); falls back to live query (`SUM/COUNT` on `orders` filtered by org + date range). Cap the live fallback at 60-day lookback to keep queries small.
2. Same-weekday LTM avg = average of 52 weeks at the same `EXTRACT(dow)` (excluding nulls). If < 4 historical rows, return `null` and the card shows "—".
3. Endpoint cached at the Express layer for 60 seconds per `(orgId, date)` using a tiny in-memory LRU.
4. Card renders via TanStack Query (`refetchInterval: 60_000`).
5. Deltas: `((today.revenue - lastWeek.revenue) / lastWeek.revenue) * 100`, rounded; show arrow + percent + small absolute.
6. Mobile dashboard layout: card stacks vertically.

**Out of scope:**

- Custom date range selection (the dashboard already has filters elsewhere).
- Multi-location comparison (sum across active org locations for now).
- Live ticker (SSE).

**DoD:**

- Card renders on dashboard within 200ms with cache hot; < 1s cache cold.
- Numbers tie out to a manual `SUM(total) FROM orders WHERE …` for today.
- When `analytics_daily` is empty, fallback live path returns correct numbers.
- Refresh every 60s without page reload.

**Verification:**

- Vitest: `kpi.spec.ts` — boundary cases (no orders today, no historical data).
- Manual: hit dashboard, place a test order, wait ≤ 60s, watch numbers update.

**PR title:** `feat(analytics): daily KPI card on dashboard`

---

## Brief A2 — RFM customer segmentation page

**Goal:** Score every customer on Recency / Frequency / Monetary; assign one of {Champions, Loyal, At-Risk, Lost, New, Promising}. Page lists segments with counts, allows drill-down to customer list with CSV export.

**Touch:**

- `+ migrations/032_customer_rfm.sql` — `customer_rfm (org_id, customer_id, recency_score smallint, frequency_score smallint, monetary_score smallint, segment varchar(24), computed_at timestamptz, primary key (org_id, customer_id))`
- `~ shared/schema.ts`
- `+ shared/analytics/rfm.ts` — pure: `computeRfm(orders, asOf) → { r, f, m, segment }`; quintile bucketing per metric
- `+ server/workers/rfmWorker.ts` — registers on a nightly job (cron at 03:00 local org TZ via existing job queue); recomputes per org
- `+ server/routes/analytics.ts` add `GET /api/analytics/rfm` (segment counts) + `GET /api/analytics/rfm/customers?segment=` (paginated)
- `+ client/src/pages/analytics/rfm.tsx` — 6 segment cards + paginated table for selected segment + CSV export
- `+ client/src/components/charts/RfmHeatmap.tsx` — 5×5 grid (R × F) coloured by monetary average

**Steps:**

1. Quintile bucketing per org so small datasets still partition cleanly; fall back to ≤ quartiles if < 50 customers.
2. Segment rules (standard RFM map):
   - **Champions**: R=5, F≥4, M≥4
   - **Loyal**: F≥4, M≥3, R≥3
   - **Promising**: R≥4, F≤2
   - **At-Risk**: R≤2, F≥3, M≥3
   - **Lost**: R≤2, F≤2
   - **New**: only 1 order, R=5
3. Worker writes `customer_rfm` rows in batch upsert.
4. Endpoint serves pre-computed reads (fast).
5. Page: 6 cards with counts; click → table.
6. CSV export uses streaming response.

**Out of scope:**

- Live re-computation on every order (worker nightly is enough).
- Email campaign integration (separate brief).
- Time-decayed scoring.

**DoD:**

- Worker runs nightly; `customer_rfm` populated for every active org.
- Page shows 6 segments with non-zero counts on an org that has ≥ 20 customers and ≥ 100 orders.
- CSV export for a segment downloads (header + rows).
- Migration idempotent.

**Verification:**

- Vitest: `rfm.spec.ts` — segment assignments correct for canned datasets.
- Manual: trigger worker via admin "Run now" → page populates.

**PR title:** `feat(analytics): RFM segmentation + page`

---

## Brief A3 — Hour-of-day sales heatmap

**Goal:** A 7×24 grid (rows = weekday, columns = hour) coloured by average sales for that bucket over the last 12 weeks. Informs staffing decisions.

**Touch:**

- `+ shared/analytics/hourOfDay.ts` — pure aggregator over `orders` filtered by org + 12-week window; returns `[{ dow, hour, avgRevenue, txns }]`
- `+ server/routes/analytics.ts` add `GET /api/analytics/hour-of-day?weeks=12`
- `+ client/src/components/charts/HourHeatmap.tsx` — 7×24 grid, cell tooltip with revenue + txn count
- `+ client/src/pages/analytics/hour-of-day.tsx`
- `~ client/src/components/nav-items.ts` — add under Analytics group

**Steps:**

1. Aggregator groups by `EXTRACT(dow)` and `EXTRACT(hour FROM created_at AT TIME ZONE org.tz)`.
2. Endpoint cached 5 min per `(orgId, weeks)`.
3. Heatmap uses a sequential colour scale (CSS) — high-contrast and `prefers-reduced-motion`-safe.
4. Tooltip: "Mon 14:00 — £312 avg, 18 orders".
5. Empty buckets render flat — no extrapolation.

**Out of scope:**

- Forecasting / smoothing.
- Per-location split (sum across locations for now).
- Hour-of-day for refunds (separate metric if requested).

**DoD:**

- Page renders for an org with at least 4 weeks of data.
- Tooltip values match manual aggregation on a sample bucket.
- Cache hit returns under 50ms server-side.

**Verification:**

- Vitest: `hourOfDay.spec.ts` — boundary (week with zero sales).
- Manual: pick "Mon 14:00", confirm count matches `SELECT count(*) FROM orders WHERE dow=1 AND hour=14`.

**PR title:** `feat(analytics): hour-of-day sales heatmap`

---

## Brief A4 — Stock turn ratio per category

**Goal:** Show, per product category, days of stock on hand and turn rate (units sold / avg stock) over the last 90 days. Flag categories with > 90 days of stock (slow-mover).

**Touch:**

- `+ shared/analytics/stockTurn.ts` — pure: given category × (cogs window) × (avg inventory window) → `{ daysOfStock, turnRate, status }`
- `+ server/routes/analytics.ts` add `GET /api/analytics/stock-turn?windowDays=90`
- `+ client/src/pages/analytics/stock-turn.tsx` — sortable table (category, units sold 90d, avg stock, days of stock, turn rate, status badge)
- `+ client/src/components/charts/StockTurnBars.tsx` — horizontal bars per category (optional but cheap)

**Steps:**

1. Average inventory = simple mean of daily snapshots from `inventory_movements` (or `analytics_daily` if it stores inventory deltas).
2. Units sold = `SUM(qty) FROM order_lines JOIN orders ON … WHERE created_at > now() - interval '90 days'`.
3. Days of stock = `(avgStock / dailySalesRate)`.
4. Status badge: green < 30 days, amber 30–90, red > 90.
5. Table sortable by any column; default sort = days-of-stock DESC (slowest first).

**Out of scope:**

- Per-SKU drill-down on this brief (table at category level only).
- Seasonality adjustments.
- Forecasting reorder quantities (covered later if needed).

**DoD:**

- Page lists every category with at least one product.
- Days-of-stock + turn match a manual computation.
- Slow-mover red rows visible at top by default.

**Verification:**

- Vitest: aggregator boundary cases (zero sales, zero stock, both).
- Manual: pick a category; compute manually; match.

**PR title:** `feat(analytics): stock turn per category + slow-mover flag`

---

## Brief A5 — Promotion lift measurement

**Goal:** For each promotion, compare revenue + AOV + new-customer share during the promo period to a matched baseline period of equal length. Show "lift %" per metric.

**Touch:**

- `+ shared/analytics/promoLift.ts` — pure: `computePromoLift(orders, promotion, baselineRangeOverride?) → { revenueLift, aovLift, newCustomerLift }`
- `+ server/routes/analytics.ts` add `GET /api/analytics/promotions/:id/lift?baselineWeeks=4`
- `+ client/src/pages/promotions/[id]/lift.tsx` — three KPI cards (revenue / AOV / new-customer share) with lift % vs baseline
- `+ client/src/components/charts/PromoLiftChart.tsx` — bar chart side-by-side (baseline vs promo)
- `~ client/src/pages/promotions.tsx` — promo row links to its lift report

**Steps:**

1. Baseline window = `promo.start - baselineWeeks` to `promo.start` (default 4 weeks). Allow override via query.
2. New-customer share = `count(distinct customer_id where first_order_at within window) / count(distinct customer_id within window)`.
3. Lift formulas: `((promo - baseline) / baseline) × 100`. Null when baseline = 0.
4. Endpoint cached 5 min per `(orgId, promoId, baselineWeeks)`.
5. Page also lists the promo's redemption count for context.

**Out of scope:**

- Causal inference (treatment vs control). Pure descriptive comparison only.
- Cross-promo cannibalisation reports.

**DoD:**

- Picking any past promo on the promotions page shows the lift report.
- Lift % matches a manual calculation on a sample promo.
- Baseline override via UI input recomputes correctly.

**Verification:**

- Vitest: `promoLift.spec.ts` — zero-baseline handling, equal periods.
- Manual: pick a known promo; compute lift manually; match.

**PR title:** `feat(analytics): promotion lift report per promo`
