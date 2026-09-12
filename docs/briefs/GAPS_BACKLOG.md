# Gaps & snags backlog

**Purpose:** Close the delta between brief **Definition of Done** and what is on `main`. Check items off in PRs or ops runbooks.

**Status tracker:** [`BRIEF_STATUS.md`](./BRIEF_STATUS.md) · **Launch:** [`WAVE12_LAUNCH.md`](./WAVE12_LAUNCH.md) · **Next wave:** [`WAVE13_NEXT.md`](./WAVE13_NEXT.md)

---

## How to use

1. Pick an unchecked item.
2. Open the linked brief section for full DoD.
3. PR title: `fix(<area>): <gap-id> <short description>`
4. When merged, check the box here and note PR in the **Closed** column.

---

## H1 — Security hardening

<a id="gap-h1-01"></a>

### GAP-H1-01 — Production HSTS header verified

| | |
|---|---|
| **Brief** | H1 |
| **Snag** | HSTS documented in nginx example + deploy doc; **not verified** on live `viger.cloud` |
| **Fix** | On VPS: ensure Certbot HTTPS block includes `Strict-Transport-Security`; run `bash scripts/verify-production-headers.sh` or `curl -sI https://viger.cloud/midnight/api/health` |
| **Closed** | [x] 2026-06-06 — verified via `scripts/verify-production-headers.sh` (HSTS present on live) |

<a id="gap-h1-02"></a>

### GAP-H1-02 — Clerk-safe CSP strategy (optional tighten)

| | |
|---|---|
| **Brief** | H1 |
| **Snag** | `contentSecurityPolicy: false` in `server/security.ts` (intentional for Clerk+Vite) |
| **Fix** | Either document as accepted risk in `SECURITY_REVIEW.md` sign-off, or implement nginx-only CSP per H1 steps and re-test sign-in |
| **Closed** | [x] 2026-06-05 — accepted risk in `SECURITY_REVIEW.md` § CSP sign-off |

---

## E2 — Liquid Metal shell

<a id="gap-e2-01"></a>

### GAP-E2-01 — Non-POS pages Liquid Metal pass

| | |
|---|---|
| **Brief** | E2 |
| **Snag** | Wave 3 E2 scoped Layout + POS; Settings, reports, some list chrome may still use default shadcn only |
| **Fix** | Wave 10 or dedicated `feat/e2-shell-remainder` — apply `liquid-metal` / card variants per `PHASE_E_LIQUID_METAL.md` |
| **Closed** | [x] Wave 10b — settings + reports (`PageHeader`, `LM_CARD`) |

<a id="gap-e2-02"></a>

### GAP-E2-02 — Setup wizard Liquid Metal shell

| | |
|---|---|
| **Brief** | E2 |
| **Snag** | `setup-wizard.tsx` used default `bg-background` while `onboarding.tsx` / `onboarding-wizard.tsx` use `lm-auth-shell` |
| **Fix** | Wave 11 Agent 1 — [`WAVE11_NEXT.md`](./WAVE11_NEXT.md) §2 |
| **Closed** | [x] PR #32 — 2026-06-10 |

<a id="gap-e2-03"></a>

### GAP-E2-03 — List pages Liquid Metal shell

| | |
|---|---|
| **Brief** | E2 |
| **Snag** | `inventory.tsx`, `locations.tsx`, `user-access.tsx` used `min-h-screen bg-background` + duplicate sticky headers inside `Layout` |
| **Fix** | Wave 12 — `PageHeader` + `LM_CARD` (mirror `insights.tsx`) |
| **Closed** | [x] PR #35 — 2026-06-11 |

---

## Auth — Clerk session sync

<a id="gap-auth-01"></a>

### GAP-AUTH-01 — JWT before server session sync

| | |
|---|---|
| **Snag** | API calls before Clerk JWT available → 401 session |
| **Fix** | `waitForClerkToken()` before session probe |
| **Closed** | [x] PR #31 — 2026-06-09 |

<a id="gap-auth-02"></a>

### GAP-AUTH-02 — CancelledError aborting sign-in

| | |
|---|---|
| **Snag** | TanStack query cancel during `useEnterApp` surfaced as sign-in failure |
| **Fix** | Plain `fetch` probe; no concurrent `fetchQuery` on auth key |
| **Closed** | [x] PR #36 — 2026-06-12 |

<a id="gap-auth-03"></a>

### GAP-AUTH-03 — ClerkSessionSync refetch race

| | |
|---|---|
| **Snag** | `ClerkSessionSync` invalidated `/api/auth/user` before JWT hydrated; `withRetries` on `createProduct` could duplicate rows |
| **Fix** | Gate invalidation on `waitForClerkToken()`; remove retry wrapper from create |
| **Closed** | [x] PR #37 — 2026-06-12 |

---

## U1 — Skeletons & empty states

<a id="gap-u1-01"></a>

### GAP-U1-01 — Orders / invoices empty states

| | |
|---|---|
| **Brief** | U1 |
| **Snag** | `orders.tsx`, `invoices.tsx` use `EmptyStatePanel` without primary CTA from shared `<EmptyState>` |
| **Fix** | Align with `UI_PATTERNS.md` or document exception in `UI_PATTERNS.md` |
| **Closed** | [x] Wave 10b — `EmptyState` + Open POS / View orders CTAs |

### GAP-U1-02 — Reports loading / empty

| | |
|---|---|
| **Brief** | U1 |
| **Snag** | `reports.tsx` has skeleton; no list-style empty state for zero-data dashboards |
| **Fix** | Add `EmptyState` or dashboard-specific empty panel |
| **Closed** | [x] Wave 10b — `insights.tsx` zero-data empty + Last 30 days preset |

### GAP-U1-03 — Import flows

| | |
|---|---|
| **Brief** | U1 touch list |
| **Snag** | `client/src/components/import/*` may still use legacy spinners |
| **Fix** | Pass import modals with `Skeleton` / `EmptyState` |
| **Closed** | [ ] |

---

### GAP-TEST-01 — E2E/a11y tenant context (fixed 2026-06-06)

| | |
|---|---|
| **Snag** | Playwright POS/a11y tests ran axe on onboarding wizard redirect, not tenant pages (missing org + onboarding completion) |
| **Fix** | `tests/helpers/e2eTenant.ts` — complete onboarding + set org before navigation |
| **Closed** | [x] 2026-06-06 — visual + a11y critical paths |

---

## U2 — Command palette

<a id="gap-u2-01"></a>

### GAP-U2-01 — Brief mount location

| | |
|---|---|
| **Brief** | U2 |
| **Snag** | Brief says `Layout.tsx`; implementation uses `App.tsx` (works globally) |
| **Fix** | Update `PHASE_U_UX_POLISH.md` U2 touch to `App.tsx` **or** move mount (low priority) |
| **Closed** | [x] 2026-06-06 — brief touch updated to `App.tsx` |

---

## U4 — Bulk actions

<a id="gap-u4-01"></a>

### GAP-U4-01 — Select all matching filter

| | |
|---|---|
| **Brief** | U4 |
| **Snag** | `useBulkSelection` only selects visible rows |
| **Fix** | Server-side count + “Select all N matching” with confirm |
| **Closed** | [ ] |

<a id="gap-u4-02"></a>

### GAP-U4-02 — Bulk change category (products)

| | |
|---|---|
| **Brief** | U4 |
| **Snag** | `changeCategory` in types; not in `PRODUCT_ACTIONS` or handler |
| **Fix** | Wire action + API + confirm |
| **Closed** | [ ] |

<a id="gap-u4-03"></a>

### GAP-U4-03 — Bulk export streaming

| | |
|---|---|
| **Brief** | U4 |
| **Snag** | Large CSV via `res.send` not stream |
| **Fix** | `res.write` / stream for 10k+ rows (optional until needed) |
| **Closed** | [ ] |

<a id="gap-u4-04"></a>

### GAP-U4-04 — Server Vitest for bulk routes

| | |
|---|---|
| **Brief** | U4 verification |
| **Snag** | Only `shared/bulkActions.spec.ts` |
| **Fix** | Route integration tests for `POST /api/*/bulk` |
| **Closed** | [ ] |

---

## U5 — Accessibility

<a id="gap-u5-01"></a>

### GAP-U5-01 — eslint-plugin-jsx-a11y (Wave 8b)

| | |
|---|---|
| **Brief** | U5 |
| **Snag** | Plugin + config on `main`; `npm run lint:strict` not green repo-wide |
| **Fix** | Incremental PRs to clear `npm run lint:strict`; then remove POS from `ignorePatterns` |
| **Closed** | [x] 2026-06-04 (infra) — [ ] full strict pass |

<a id="gap-u5-02"></a>

### GAP-U5-02 — Manual keyboard-only POS walkthrough

| | |
|---|---|
| **Brief** | U5 DoD |
| **Snag** | Not recorded in repo |
| **Fix** | Run once; add sign-off line to `docs/ACCESSIBILITY.md` with date |
| **Closed** | [ ] |

<a id="gap-u5-03"></a>

### GAP-U5-03 — Reduced motion on palette / dialogs

| | |
|---|---|
| **Brief** | U5 |
| **Snag** | Command palette / some modals may not honor `prefers-reduced-motion` everywhere |
| **Fix** | Audit motion classes; align with U1 `motion-reduce` pattern |
| **Closed** | [ ] |

<a id="gap-u5-04"></a>

### GAP-U5-04 — "Order open ≥60min" red label fails WCAG AA contrast

| | |
|---|---|
| **Brief** | U5 (found during Phase 1 combined-branch validation, not by any of PRs #175/#176/#178/#179/#180 — confirmed pre-existing, see below) |
| **Snag** | `orders-row.tsx`'s elapsed-time indicator turns `text-destructive` once an order has been open 60+ minutes (`useElapsed`/`tone` helper, ~line 70). That resolves to `--destructive: var(--danger)` → `--danger: hsl(2 78% 46%)` in `styles/tokens/arcarna.css` (`#d1201a`), which axe measured at **3.05:1** against the row background — needs **4.5:1** for normal-size text (WCAG 1.4.3). Confirmed via CSS trace that no Phase 1 bundle touches this token; it wasn't caught by any PR's own a11y CI run because a fresh, short-lived CI database never has an order old enough to hit the 60-minute threshold — it only surfaced when the (long-running) validation session's shared dev DB had a genuinely stale open order. |
| **Fix** | Either lighten `--danger` enough to clear 4.5:1 on the dark row background (check knock-on effect everywhere else `--danger`/`--destructive` is used first), or give this specific label a dedicated higher-contrast color instead of reusing the shared destructive token. |
| **Closed** | [ ] |

---

## Workers / event bus

<a id="gap-worker-01"></a>

### GAP-WORKER-01 — Deterministic worker failures retried like transient ones

| | |
|---|---|
| **Brief** | Found live in production logs the night of the Phase 1 deploy (2026-09-09) — `InventoryWorker` stuck retrying event `13866ebd-...` (a `StockError: Insufficient stock at location` — an order oversold a product already at 0 stock at that location). Pre-existing, not caused by that deploy. |
| **Snag** | `failJob()` (`server/eventBus.ts`) applies the same exponential-backoff-then-dead-letter policy (10 attempts, backoff capped at 15 min — so up to ~30-45 min total) to every worker failure alike. That's the right call for a transient failure (a dropped DB connection, a momentary lock), but `StockError: Insufficient stock` (`server/services/productLocationStock.ts`) is deterministic — stock isn't going to become sufficient between retry N and N+1, so those 10 attempts (`server/workers/index.ts`'s `failJob(...)` call sites don't distinguish) just burn a worker slot for the better part of an hour before anyone finds out. Once it does land in `dead_letters`, `controlCentre.ts` does raise a "background job(s) failed permanently" Control Centre alert — but that page is SUPER_ADMIN-only, and it's ~30-45 minutes after the actual oversell. |
| **Fix** | Classify errors at the point they're thrown (or via an `instanceof`/error-code check in the catch in `server/workers/index.ts`) as retryable vs terminal; route terminal ones (`StockError` and similarly deterministic business errors) straight to `dead_letters` on the first failure instead of scheduling a retry. |
| **Closed** | [ ] |

---

## P10b — Product analytics

<a id="gap-p10b-01"></a>

### GAP-P10B-01 — Plausible dashboards (operator)

| | |
|---|---|
| **Brief** | P10b |
| **Snag** | Code env-gated; no dashboards/goals in Plausible UI |
| **Fix** | Set `VITE_PLAUSIBLE_DOMAIN` on VPS, rebuild; configure goals in Plausible |
| **Closed** | [ ] |

---

## F6 — Barcode (follow-ups)

<a id="gap-f6-01"></a>

### GAP-F6-01 — Bulk barcode print on products page

| | |
|---|---|
| **Brief** | F6 |
| **Snag** | Deferred in F6 PR |
| **Fix** | New brief **F8** or small PR: print labels from product list |
| **Closed** | [ ] |

<a id="gap-f6-02"></a>

### GAP-F6-02 — Migration 029 only if prod lacks column

| | |
|---|---|
| **Brief** | F6 |
| **Snag** | No `029_products_barcode.sql` in repo |
| **Fix** | Run `npm run migration:sanity` on prod; add 029 only if column missing |
| **Closed** | [ ] |

---

## Permissions — per-employee feature overrides

<a id="gap-perm-01"></a>

### GAP-PERM-01 — Per-employee section/feature grants beyond role defaults

| | |
|---|---|
| **Brief** | Owner request, raised during the Phase 1 settings/nav bundle (PR #180, ARC-006/007/008/009) |
| **Ask** | Admins should be able to switch on individual sections/functions for one employee beyond what their role gets by default — e.g. give a trusted CASHIER read access to one analytics report to bring to a meeting, without promoting them to MANAGER. Owner's own words: "if org wanted to allow a cashier analytics access to bring a weekly report to a meeting etc we could give them access to that section without making them a full manager." |
| **Status** | Deliberately deferred, not part of Phase 1. Phase 1 (PRs #175/#176/#178/#179/#180) delivers correct role-based defaults for the four fixed roles (CASHIER/MANAGER/ADMIN/SUPER_ADMIN) — this sits on top of that, as its own feature. |
| **What it needs** | (1) A per-user override store — something like `user_feature_grants(userId, orgId, featureKey, grantedBy, grantedAt, expiresAt?)`. (2) A defined, enumerable set of grantable feature keys — the natural unit is one per nav item (`client/src/components/nav-items.ts`) or, for Reports Hub specifically, one per report, since that hub currently has no per-report server check at all (flagged as PR #180's judgment call #1 — granting a single report needs that split built first). (3) `rolesForHref`/`RequireRole` (`client/src/components/nav-items.ts`, `client/src/components/RequireRole.tsx`) checking "role default OR explicit grant" instead of role alone. (4) The equivalent check server-side — every `requireRole(...)` call gating a route a grant should unlock needs an "or has an explicit grant for this org+feature" branch, not just the client hidden/shown state (client-only gating would be security theatre). (5) Admin UI to grant/revoke, most likely on `user-access.tsx` next to role/commission/default-location. |
| **Fix** | New feature — needs its own schema + design pass, not a small PR. |
| **Closed** | [ ] |

---

## Ops (not code)

| ID | Task | Closed |
|----|------|--------|
| **GAP-O1-01** | External uptime on `/midnight/api/health` — see [docs/ops/UPTIME_MONITORING.md](../ops/UPTIME_MONITORING.md) | [x] 2026-06-11 |
| **GAP-O2-01** | M4 restore drill + sign-off in `DISASTER_RECOVERY.md` | [ ] |
| **GAP-O3-01** | `pm2 startup` + `pm2 save` (+ optional reboot test) | [ ] |
| **GAP-M4-01** | Same as O2 — M4 DoD | [ ] |

**Consolidated checklist:** [docs/ops/OPERATOR_CHECKLIST.md](../ops/OPERATOR_CHECKLIST.md)

---

## Operations Centre — found during the Phase N review (2026-09-11)

All pre-existing; none introduced by Phase N. Each is fixed by the package named, or recorded for a later change.

<a id="gap-ops-01"></a>

### GAP-OPS-01 — Order ops / rating capture unreachable since PR #136

| | |
|---|---|
| **Brief** | L5 / ARC-T1-003, ARC-T1-005, ARC-T2-003 |
| **Snag** | `client/src/pages/orders.tsx` L91: `selectedOrder` is only ever written inside the status mutation behind a `selectedOrder?.id === orderId` guard, so it is always null and the *Collection & delays* / *Rate collection* buttons, `OrderOpsDialog` and `SatisfactionDialog` never render (the setter went with `openStatusDialog` in 0b611ac). No UI has written `eta_given` / `delay_flag` / satisfaction for three weeks; the three reports have had no feed. |
| **Fix** | N4a replaces the dialog with inline delay capture on the card and rating chips on completed cards; N4b deletes both dialogs. |
| **Closed** | [ ] |

<a id="gap-ops-02"></a>

### GAP-OPS-02 — Website orders lose their fulfilment method

| | |
|---|---|
| **Brief** | C-series / website ingest |
| **Snag** | `server/services/website.ts` L568–586 never passes `fulfilmentMethod` to `placeOrder`, and `shared/website.ts` L163 uses `pickup` where orders use `collection`. Every web delivery is stored as a collection. |
| **Fix** | N3a: map `pickup → collection`, pass `fulfilmentMethod`, give web orders a promise, unit test. |
| **Closed** | [ ] |

<a id="gap-ops-03"></a>

### GAP-OPS-03 — Bulk “Set status” bypasses settlement, attribution, credit and events

| | |
|---|---|
| **Brief** | U4 |
| **Snag** | `server/lib/bulkActionHandler.ts` L157–173 writes any string into `orders.status` with no validation; setting `completed` this way freezes no `settled_total`, records no completer and publishes nothing. `orders.status` has no CHECK constraint. |
| **Fix** | N3b removes `POST /api/orders/bulk` and `handleOrderBulk` (no caller after N1). If bulk status is ever wanted back, it must call `completeOrderTx`. |
| **Closed** | [ ] |

<a id="gap-ops-04"></a>

### GAP-OPS-04 — Bell leaks cross-tenant counts

| | |
|---|---|
| **Brief** | S4 / tenancy |
| **Snag** | `server/services/operationalIntelligence.ts` `getNotifications` L371–375 (pending approvals) and L392–404 (dead letters) are not filtered by `orgId`; every org's bell shows every org's approvals and dead letters. |
| **Fix** | Not in the Phase N packages (the board has its own alert feed). A one-line org filter plus `notificationsOrgScope.test.ts`, any time. |
| **Closed** | [ ] |

<a id="gap-ops-05"></a>

### GAP-OPS-05 — Order expenses collected at checkout are never sent

| | |
|---|---|
| **Brief** | U7 / K-series |
| **Snag** | `client/src/pages/pos.tsx` L136–139 keeps `orderExpenses`, validates them (L647–656) and passes them to the step, but `orderData` (L680–763) never includes them and the server writes `order_expenses` only for personal use. Silent data loss. |
| **Fix** | Owner chose to wire it (2026-09-12, Q12): N6 sends `expenses[]` from checkout, `PlaceOrderInput` declares it, and the create transaction inserts `order_expenses` rows on the path personal use already uses; `orderExpenses.test.ts` proves rows land and `total` is untouched. |
| **Closed** | [ ] |

<a id="gap-ops-06"></a>

### GAP-OPS-06 — Collection satisfaction rating has no capture point

| | |
|---|---|
| **Brief** | ARC-T2-003 |
| **Snag** | `SatisfactionDialog` was only reachable from the dead block in GAP-OPS-01, so ARC-T2-003 has had no feed since #136. |
| **Fix** | N4a adds `OpsRateChips` (1–5) on completed cards posting to `POST /api/satisfaction`; N4b deletes the dialog. |
| **Closed** | [ ] |

<a id="gap-ops-07"></a>

### GAP-OPS-07 — `apps/server/src/db/schema.ts` lacks five operational `orders` columns

| | |
|---|---|
| **Brief** | S1 / schema drift |
| **Snag** | `queue_position`, `delay_cause`, `original_eta`, `delay_notification_sent_at`, `delay_resolution` exist in `shared/schema.ts` and the database but not in the snake_case file; `scripts/audit-schema-drift.mjs` ignores columns present in only one file, so CI is silent while `GET /api/orders` cannot select them. |
| **Fix** | N2 declares the four delay columns and drops `queue_position` (no reader or writer after N3b/N7); N2 also gives `scripts/audit-schema-drift.mjs` a paired-table rule for `orders` that fails on single-file columns and compares `withTimezone`. |
| **Closed** | [x] Migration 065 / N2: the four delay columns are declared in both files, `queue_position` is dropped from the database and both schemas, and `PAIRED_TABLES = ['orders']` now fails on a column declared in only one file (the parser also strips comments first, so a commented-out column no longer counts as declared). |

<a id="gap-ops-08"></a>

### GAP-OPS-08 — Order completion can settle twice and borrows a second pool client inside the transaction

| | |
|---|---|
| **Brief** | K / L (settlement) |
| **Snag** | `server/routes/orders.ts` L644 reads the row on the pooled `db` *before* `withTransaction`, decides `isSettling` from it, and `creditLegTotal` (L659, `server/services/creditLedger.ts` L67) reads through the module-level `db` rather than the transaction client. Two Delivered taps a second apart both see `settled_total` null, both build a settlement patch, and the second overwrites `settled_at` and `completed_user_id`; under ~10 concurrent completions the pool (max 10) can self-deadlock. |
| **Fix** | N3b: extract `completeOrderTx(tx, lockedRow, actor)`, read the row with `SELECT … FOR UPDATE` inside the transaction, pass `tx` into `creditLegTotal`, and prove it with `orderTransitionAtomicity.test.ts` and `completionSinglePath.test.ts`. |
| **Closed** | [ ] |

<a id="gap-ops-09"></a>

### GAP-OPS-09 — `OrderStatusChanged` fans out on no-op status writes

| | |
|---|---|
| **Brief** | S2 / automation |
| **Snag** | `PATCH /api/orders/:id` publishes `OrderStatusChanged` even when `from === to`; the event reaches four workers and `server/services/automationEngine.ts`, which loads every enabled rule for the type without checking that the status changed. A stage write reusing this event would fire customer-facing rules once per tap. |
| **Fix** | N3b: add `OrderStageChanged` to `EVENT_TYPES` with no required workers for stamps; publish `OrderStatusChanged` only when `status` actually changes; test that a `claim` publishes none. |
| **Closed** | [ ] |

<a id="gap-ops-10"></a>

### GAP-OPS-10 — Service worker serves cached API JSON as a fresh 200 when the server is down

| | |
|---|---|
| **Brief** | P10 / PWA |
| **Snag** | `client/public/sw.js` fetch handler caches every API GET and answers from cache with the original 200 on network failure, so React Query records a successful fetch and `navigator.onLine` stays true whenever Wi-Fi is up but the WAN or server is down. Any live screen looks live while stale. |
| **Fix** | N3a: never cache `/api/orders/board`; the board judges staleness from `serverNow` in the payload. General fix (a `X-From-Cache` header on cache hits, honoured by `queryClient`) is a follow-on. |
| **Closed** | [ ] |

<a id="gap-ops-11"></a>

### GAP-OPS-11 — Offline-replayed orders are born “received now”

| | |
|---|---|
| **Brief** | F6 / offline |
| **Snag** | `server/middleware/requireActiveCashierShift.ts` L98–113 honours `_offlineQueuedAt` only with a replay token that is set by `pos/shift-open.tsx`, which is no longer mounted; on the lazy-shift path a replayed order's `entered_at`/`created_at` are the replay time, so its wait clock and any promise are wrong. |
| **Fix** | N3a: honour `_offlineQueuedAt` without a token on the lazy-shift path, bounded to the current trading day; `offlineQueuedAt.test.ts`. |
| **Closed** | [ ] |

<a id="gap-ops-12"></a>

### GAP-OPS-12 — Daily close ignores orders still open from the day

| | |
|---|---|
| **Brief** | L3 |
| **Snag** | `server/services/dailyClose.ts` L173–184 totals completed rows only; orders left open are neither reported nor carried anywhere, so at 06:00 they would sit red at the top of a live board and a next-morning completion records a 14-hour handover. |
| **Fix** | N7: the close summary gains “n orders still open from this day”; the board shows a Yesterday strip with no clocks or alerts and asks for the actual handover time on completion. |
| **Closed** | [ ] |

<a id="gap-ops-13"></a>

### GAP-OPS-13 — Migrations are re-applied on every deploy, so a backfill must be idempotent

| | |
|---|---|
| **Brief** | S1 / schema evolution |
| **Snag** | `scripts/apply-migrations-pm2.sh` and the CI loop run every `migrations/*.sql` on every deploy with `ON_ERROR_STOP=0`. DDL is `IF NOT EXISTS` throughout, but any data backfill that is not a no-op on re-run fabricates rows on each release, and CI cannot see it because `db:push` already built the tables. |
| **Fix** | Rule recorded in `docs/SCHEMA_EVOLUTION.md` by N9b; N2's DoD applies 065 twice against the seeded database and asserts the `order_events` count is unchanged. |
| **Closed** | [ ] |

---

## Docs hygiene

| ID | Task | Closed |
|----|------|--------|
| **GAP-DOC-01** | `MASTER_EXECUTION_PLAN.md` §8 matches `BRIEF_STATUS.md` | [x] 2026-06-04 |
| **GAP-DOC-02** | Briefs README points to current wave (`WAVE12_LAUNCH` / `WAVE13_NEXT`) | [x] 2026-06-12 |

---

## Suggested fix waves (optional)

| Batch | Gaps | Effort |
|-------|------|--------|
| **Snag sweep A** | U2-01 (doc), GAP-DOC, U5-02 sign-off | 1 hour |
| **Snag sweep B** | U1-01–03, U4-01–02 | 1–2 PRs |
| **Wave 8b** | U5-01, U5-03 | 1 PR |
| **Ops day** | O1, O2, O3, H1-01 | VPS only |
| **Wave 10** | E2-01, F6-01, U4-03–04 | As needed |
