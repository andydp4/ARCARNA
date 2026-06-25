# ARCARNA™ Route Experience Specification

> **Agent 1 — Route Architect.** Subordinate to
> [`ARCARNA_FOUNDATION_SPECIFICATION.md`](./ARCARNA_FOUNDATION_SPECIFICATION.md); uses approved
> terms from the [Language spec](./ARCARNA_LANGUAGE_SPECIFICATION.md) and components from the
> [Component spec](./ARCARNA_COMPONENT_SPECIFICATION.md).
>
> **Core rule — every route must answer:** *What question does this page answer? What truth does it
> reveal? What action does it enable?* (Foundation §11.)
>
> **Source of truth for routes:** [`client/src/App.tsx`](../../client/src/App.tsx) (router) and
> [`client/src/components/nav-items.ts`](../../client/src/components/nav-items.ts) (nav). Approved
> names/labels are the **target**; current labels are noted where they differ (Compliance Report
> records the gap).

---

## 1. Global navigation architecture

- **Mount:** app lives at `/arcarna` (base path); legacy `/midnight/*` → 301. Portal at `/`.
- **Shell:** `Layout` wraps all authenticated routes (header + grouped sidebar + always-on Signals,
  Command Palette, Arcarna Voice bar, WhatsApp panel).
- **Access:** unauthenticated `/` → Landing; authenticated routes gated by `AccessGate`;
  `User Access`/admin routes gated by role (`SUPER_ADMIN`/`ADMIN`).
- **Nav is grouped into six** (replacing the current flat list): **Control Centre · Sell · Stock ·
  Understand · Operate · Administer**. Group = the eyebrow on each `PageHeader`.
- **Mobile:** off-canvas sheet nav + bottom thumb zone; **desktop:** collapsible rail.

## 2. Route inventory (summary)

| # | Route | Group | Approved name | Priority |
|---|-------|-------|---------------|----------|
| 1 | `/` | Control Centre | Control Centre | P0 |
| 2 | `/create-order` | Sell | Create Order | P0 |
| 3 | `/open-orders` | Sell | Open Orders | P0 |
| 4 | `/open-orders/:id/refund` | Sell | Refund Order | P1 |
| 5 | `/shifts` | Sell | Shifts | P1 |
| 6 | `/invoices` | Sell | Invoices | P1 |
| 7 | `/tick-list` | Sell | Tick List | P1 |
| 8 | `/products` | Stock | Products | P0 |
| 9 | `/inventory` | Stock | Inventory | P0 |
| 10 | `/purchase-drafts` | Stock | Purchase Drafts | P1 |
| 11 | `/insights` | Understand | Truths | P1 |
| 12 | `/analytics/rfm` | Understand | Customer Segments | P1 |
| 13 | `/analytics/hour-of-day` | Understand | Busiest Hours | P2 |
| 14 | `/analytics/channels` | Understand | Order Channels | P2 |
| 15 | `/analytics/stock-turn` | Understand | Stock Turn | P2 |
| 16 | `/expense-reports` | Understand | Profit Analysis | P1 |
| 17 | `/scheduled-reports` | Understand | Scheduled Evidence | P2 |
| 18 | `/customers` | Operate | Customers | P0 |
| 19 | `/loyalty` | Operate | Loyalty | P1 |
| 20 | `/promotions` | Operate | Promotions | P1 |
| 21 | `/promotions/:id/lift` | Operate | Promotion Lift | P2 |
| 22 | `/gift-cards` | Operate | Gift Cards | P1 |
| 23 | `/locations` | Operate | Locations | P1 |
| 24 | `/expenses` | Operate | Expenses | P1 |
| 25 | `/settings` | Administer | Settings | P0 |
| 26 | `/settings/receipts` | Administer | Receipt Settings | P1 |
| 27 | `/settings/loyalty` | Administer | Loyalty Settings | P1 |
| 28 | `/settings/developer` | Administer | Developer | P2 |
| 29 | `/user-access` | Administer | User Access | P1 |
| 30 | `/audit-logs` | Administer | Audit Log | P2 |
| 31 | `/worker-logs` | Administer | System Activity | P2 |
| 32 | `/rules` | Administer | Rules | P2 |

Legacy aliases, onboarding, and auth routes are inventoried in §10–§12.

---

## 3. Control Centre

| Route | Component | Approved name | Question → Truth → Action | Required components | Priority |
|-------|-----------|---------------|---------------------------|--------------------|----------|
| `/` | `pages/home.tsx` | **Control Centre** | **Q:** How is your business doing today? **T:** today's takings, profit signal, and what needs attention. **A:** jump to the weakest area / a Next Move. | `PageHeader`, `TruthCard` (DailyKpiCard), `BusinessHealthSection`, `ActivityTimeline`, `QuickActionCard`, `Signals` | P0 |

- **Copy risks:** current label "Dashboard" → **Control Centre**; quick actions use FontAwesome
  (migrate to Lucide); must lead with **one** truth, not a widget wall (Foundation §6.3).
- **Acceptance:** H1 "Control Centre" + question subtitle; KPIs are `TruthCard` (no `MetricCard`,
  no light tokens); every health item links to a Next Move; no dead-end widgets.

## 4. Sell

| Route | Component | Approved name | Question → Truth → Action | Required components | Priority |
|-------|-----------|---------------|---------------------------|--------------------|----------|
| `/create-order` | `pages/pos.tsx` | **Create Order** | **Q:** What is this customer buying? **T:** the live cart + total. **A:** take payment / save order. | POS shell, `pos-product-card`, `pos-cart-panel`, search/scan, `EmptyState` | P0 |
| `/open-orders` | `pages/orders.tsx` | **Open Orders** | **Q:** What still needs finishing? **T:** orders in progress, most urgent first. **A:** open / complete / refund. | `DataTableShell`, `orders-row`, `Skeleton`, `EmptyState` | P0 |
| `/open-orders/:id/refund` | `pages/orders/refund.tsx` | **Refund Order** | **Q:** What are we refunding, and why? **T:** the order + refundable lines. **A:** issue refund (confirmed). | `ConfirmDestructive`, line selector, `PageHeader` | P1 |
| `/shifts` | `pages/shifts.tsx` | **Shifts** | **Q:** Who was on, and did the till balance? **T:** open/closed shifts + variance. **A:** open / close shift, view Z-report. | `ZReport`, `DataTableShell`, `EmptyState` | P1 |
| `/invoices` | `pages/invoices.tsx` | **Invoices** | **Q:** Who owes you, and is it paid? **T:** outstanding vs paid. **A:** create / send / mark paid. | `invoice-row`, `DataTableShell`, `EmptyState` | P1 |
| `/tick-list` | `pages/tick-list.tsx` | **Tick List** | **Q:** Who's buying on tick, and what's outstanding? **T:** account balances. **A:** add a tab / settle. | `DataTableShell`, `EmptyState`, `ConfirmDestructive` | P1 |

- **Copy risks:** "POS"/"till"/"register" → **Create Order**; price text must be neutral, not a
  state colour; "Refund"/"Void" must name consequence in confirm modals; UK "tick"/"VAT".
- **Acceptance:** Create Order search/scan instant, targets ≥44px, optimistic add; Open Orders sorts
  most-urgent-first; all destructive actions via `ConfirmDestructive`; every list has skeleton +
  empty state.

## 5. Stock

| Route | Component | Approved name | Question → Truth → Action | Required components | Priority |
|-------|-----------|---------------|---------------------------|--------------------|----------|
| `/products` | `pages/product-management.tsx` | **Products** | **Q:** What you sell — and is it set up right? **T:** catalogue + setup gaps (price/aliases). **A:** add / edit / import. | `DataTableShell`, `import/*`, `EmptyState` | P0 |
| `/inventory` | `pages/inventory.tsx` | **Inventory** | **Q:** What's in stock, and what's running out? **T:** stock state per product (in/low/out). **A:** adjust / receive / transfer / reorder. | `inventory/ReceivingTab`, `ReplenishmentTab`, `SmartStockTab`, `TransfersTab` | P0 |
| `/purchase-drafts` | `pages/purchase-drafts.tsx` | **Purchase Drafts** | **Q:** What do you need to reorder? **T:** suggested/draft purchase orders. **A:** review / send to supplier. | `DataTableShell`, `EmptyState`, `ConfirmDestructive` | P1 |

- **Copy risks:** "Smart Stock" must not read as "AI" (it's rule-based, Language §11); stock state
  via colour **and** label; "supplier" not "vendor".
- **Acceptance:** stock state legible without colour; quick adjust ≤2 taps; Purchase Drafts reachable
  from nav (currently orphan — §8); import preview-before-commit retained.

## 6. Understand

| Route | Component | Approved name | Question → Truth → Action | Required components | Priority |
|-------|-----------|---------------|---------------------------|--------------------|----------|
| `/insights` | `pages/insights.tsx` | **Truths** | **Q:** What should you know right now? **T:** the top truths about the business. **A:** open the evidence / take a Next Move. | `PageHeader`, Truth components, charts, `spatial/*` (flagged) | P1 |
| `/analytics/rfm` | `pages/analytics/rfm.tsx` | **Customer Segments** | **Q:** Which customers are loyal, at risk, or lost? **T:** RFM segments. **A:** target a segment (promo/loyalty). | `charts/RfmHeatmap` | P1 |
| `/analytics/hour-of-day` | `pages/analytics/hour-of-day.tsx` | **Busiest Hours** | **Q:** When are you busiest? **T:** demand by hour. **A:** plan staffing/stock. | `charts/HourHeatmap` | P2 |
| `/analytics/channels` | `pages/analytics/channels.tsx` | **Order Channels** | **Q:** Where do orders come from? **T:** channel mix. **A:** invest in the channel that pays. | channel chart | P2 |
| `/analytics/stock-turn` | `pages/analytics/stock-turn.tsx` | **Stock Turn** | **Q:** What sells fast, and what sits? **T:** turn rate per product. **A:** reorder fast movers / clear dead stock. | stock-turn chart | P2 |
| `/expense-reports` | `pages/expense-reports.tsx` | **Profit Analysis** | **Q:** Are you actually making money? **T:** revenue vs cost vs **profit** (the £300 truth). **A:** cut the costs eating margin. | profit charts, `TruthCard` | P1 |
| `/scheduled-reports` | `pages/scheduled-reports.tsx` | **Scheduled Evidence** | **Q:** Which evidence arrives automatically? **T:** scheduled exports. **A:** schedule / edit / send. | `DataTableShell`, `EmptyState` | P2 |

- **Copy risks:** "Insights" → **Truths**; "Reports" → **Evidence**; "Analytics" → **Intelligence**
  only where needed; "RFM" keep as qualifier, lead with "Customer Segments"; Profit Analysis is the
  flagship founder-story truth — name profit explicitly, never bury it under revenue.
- **Acceptance:** every Understand route states its truth in words (not chart-only); each offers a
  Next Move; `/analytics/rfm` must use `apiFetch`/`resolveAppPath` (current hardcoded `/midnight/api`
  bug — Compliance Report); spatial shell stays behind `spatialWorkspace` flag.

## 7. Operate

| Route | Component | Approved name | Question → Truth → Action | Required components | Priority |
|-------|-----------|---------------|---------------------------|--------------------|----------|
| `/customers` | `pages/customers.tsx` | **Customers** | **Q:** Who buys from you, and what are they worth? **T:** customer value/recency. **A:** open / message / import. | `top-customers-table`, `DataTableShell`, `import/*`, `EmptyState` | P0 |
| `/loyalty` | `pages/loyalty.tsx` | **Loyalty** | **Q:** Are your best customers rewarded? **T:** points/tiers state. **A:** set up / adjust loyalty. | loyalty surfaces, `EmptyState` | P1 |
| `/promotions` | `pages/promotions.tsx` | **Promotions** | **Q:** What's on offer, and is it working? **T:** active promos + performance. **A:** create / measure lift. | `DataTableShell`, `EmptyState` | P1 |
| `/promotions/:id/lift` | `pages/promotions/lift.tsx` | **Promotion Lift** | **Q:** Did this promotion pay? **T:** incremental lift. **A:** repeat / stop. | `charts/PromoLiftChart` | P2 |
| `/gift-cards` | `pages/gift-cards.tsx` | **Gift Cards** | **Q:** What stored value is outstanding? **T:** issued/redeemed balances. **A:** issue / redeem. | `DataTableShell`, `EmptyState` | P1 |
| `/locations` | `pages/locations.tsx` | **Locations** | **Q:** How is each location performing? **T:** per-location state. **A:** add / manage location. | location cards, `EmptyState` | P1 |
| `/expenses` | `pages/expenses.tsx` | **Expenses** | **Q:** Where is your money going? **T:** cost breakdown. **A:** add / categorise expense. | `expense-row`, `DataTableShell`, `EmptyState` | P1 |

- **Copy risks:** keep glossary terms (no "clients"/"deals"/"vouchers"); promotion lift must state a
  plain truth ("this promo added £X / lost £Y"); £/VAT formatting.
- **Acceptance:** Customers fast + import preview; each Operate list has skeleton + empty state with
  a first move; lift route states a verdict, not just a chart.

## 8. Administer

| Route | Component | Approved name | Question → Truth → Action | Required components | Priority |
|-------|-----------|---------------|---------------------------|--------------------|----------|
| `/settings` | `pages/settings.tsx` | **Settings** | **Q:** How is Arcarna set up for your business? **T:** current configuration. **A:** change a setting. | `OrgNameSettings`, settings sections | P0 |
| `/settings/receipts` | `pages/settings/receipts.tsx` | **Receipt Settings** | **Q:** What do receipts show? **T:** receipt template/branding. **A:** edit receipt. | receipt form | P1 |
| `/settings/loyalty` | `pages/settings/loyalty.tsx` | **Loyalty Settings** | **Q:** How does loyalty work here? **T:** rules/tiers config. **A:** edit loyalty rules. | loyalty config form | P1 |
| `/settings/developer` | `pages/settings/developer.tsx` | **Developer** | **Q:** How do systems connect to Arcarna? **T:** API keys/scopes. **A:** create/revoke key. | API key table, `ConfirmDestructive` | P2 |
| `/user-access` | `pages/user-access.tsx` | **User Access** | **Q:** Who can do what in your business? **T:** users + roles. **A:** invite / change role / remove. | `DataTableShell`, `ConfirmDestructive`, `EmptyState` | P1 |
| `/audit-logs` | `pages/audit-logs.tsx` | **Audit Log** | **Q:** Who did what, and when? **T:** audit trail. **A:** filter / export evidence. | `DataTableShell`, `EmptyState` | P2 |
| `/worker-logs` | `pages/worker-logs.tsx` | **System Activity** | **Q:** Are background jobs healthy? **T:** worker run state. **A:** inspect / retry. | `DataTableShell`, `EmptyState` | P2 |
| `/rules` | `pages/rules.tsx` | **Rules** | **Q:** What automations are running? **T:** configured rules. **A:** add / edit / disable rule. | `DataTableShell`, `EmptyState` | P2 |

- **Copy risks:** "org"/"tenant" → "business"; Developer/API copy must avoid AI hype; audit/worker
  routes are admin — calm, factual; these are **orphan** today (not in nav — §8).
- **Acceptance:** destructive admin actions confirmed; admin routes added to the Administer nav
  group or intentionally hidden by role; API keys never logged in chrome.

---

## 9. Legacy routes and aliases

| Alias | Redirects to | Action |
|-------|-------------|--------|
| `/pos` | `/create-order` | keep redirect (muscle memory) |
| `/orders` | `/open-orders` | keep redirect |
| `/orders/:id/refund` | `/open-orders/:id/refund` | keep redirect |
| `/reports` | renders `Insights` | **collapse**: redirect `/reports` → `/insights` (Truths); don't render two names for one page (dedup) |
| `/analytics` | renders `Insights` | **collapse**: redirect `/analytics` → `/insights`; reserve `/analytics/*` for Intelligence sub-pages |
| `/midnight/*` (server) | `/arcarna/*` 301 | keep ≥30 days (rebrand) |

**Rule:** an alias may **redirect**, but two routes must not independently render the same page under
two names (Foundation §15.1). `/reports` and `/analytics` currently render `Insights` directly —
convert to redirects.

## 10. Orphan routes (registered, not in nav)

`/purchase-drafts`, `/audit-logs`, `/worker-logs`, `/rules` are reachable by URL but absent from
`nav-items.ts`.

**Owner decision (resolved):** **do not add these to primary navigation yet.** Keep them reachable
via existing deep links and admin/developer surfaces. They are intentionally not silently
unreachable — entry remains through their current links. Future placement (deferred, to be done
behind the noted gates):

| Route | Approved name | Future group | Gate |
|-------|---------------|--------------|------|
| `/purchase-drafts` | Purchase Drafts | Stock | permission / feature gated |
| `/audit-logs` | Audit Log | Administer | admin only |
| `/worker-logs` | System Activity | Administer | developer / admin only |
| `/rules` | Rules | Administer | developer / admin only |

Until then, no nav change is made for these routes.

## 11. Onboarding routes

| Route | Component | Question → Truth → Action |
|-------|-----------|---------------------------|
| `/onboarding` | `pages/onboarding.tsx` | **Q:** What does Arcarna need to know? **T:** setup progress. **A:** continue setup. |
| `/onboarding/wizard` | `pages/onboarding-wizard.tsx` | step-by-step setup; one ask per step; resume always offered. |
| `/setup-wizard` | `pages/setup-wizard.tsx` | first-run business setup; ends at Control Centre. |
| `/setup-blocked` | `pages/setup-blocked.tsx` | **Q:** Why can't you continue? **T:** blocker. **A:** the unblock step. |

- **Copy:** frame as revealing the business, not configuring software (Language §14); end-state is
  empowerment ("Here's your Control Centre."); `OnboardingResumeBanner` = "Pick up where you left off."

## 12. Auth / access routes

| Route | Component | Notes |
|-------|-----------|-------|
| `/` (unauth) | `pages/landing.tsx` | Landing/marketing — `lm-auth-shell` scope → migrate to Truth-Blue dark shell; wordmark; approved marketing lines (Language §17). |
| `/sign-in` | `pages/sign-in.tsx` | Clerk panel in auth shell; wordmark; no duplicate H1. |
| `/sign-out` | `pages/sign-out.tsx` | wordmark; "Signed out." |
| `/pending-approval` | `pages/pending-approval.tsx` | calm waiting state; what happens next. |
| `/no-access` | `pages/no-access.tsx` | plain, non-blaming; who to contact. |
| `*` | `pages/not-found.tsx` | "That page doesn't exist." + route home. No dead end. |

## 13. Settings sub-routes

`/settings` is the hub; `/settings/receipts`, `/settings/loyalty`, `/settings/developer` are
sub-routes reached from it (Developer + User Access also appear in the Administer nav group).
Each sub-route is its own `PageHeader` (title + question) and returns to Settings.

---

## 14. Implementation checklist

- [ ] Re-group `nav-items.ts` into **Control Centre / Sell / Stock / Understand / Operate /
      Administer** with approved labels (Language §3).
- [ ] Rename `/` "Dashboard" → **Control Centre**; `/insights` "Business Insights" → **Truths**.
- [ ] Convert `/reports` and `/analytics` from render-aliases to **redirects** to `/insights`.
- [x] Orphan routes: **kept out of primary nav** (owner decision, §10); reachable via existing deep
      links / admin-developer surfaces; future gated placement deferred.
- [ ] Every in-app route: `PageHeader` with `title` (approved label) + `question` subtitle.
- [ ] Every list route: `Skeleton` (load) + `EmptyState` (no data / no matches).
- [ ] Every route states its **truth in words** and offers a **Next Move** (no dead ends).
- [ ] Fix `analytics/rfm` hardcoded `/midnight/api` → `apiFetch`/`resolveAppPath`.
- [ ] Destructive routes (refund, delete, void, revoke key) use `ConfirmDestructive`.
- [ ] P0 routes meet WCAG AA + ≥44px targets (`npm run test:a11y`).
- [ ] Approved names sourced from `nav-items.ts`; brand strings from `shared/brand.ts`.
