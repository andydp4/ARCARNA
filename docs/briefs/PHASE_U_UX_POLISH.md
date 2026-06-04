# Phase U — UX polish

**Status (2026-06-04):** [`BRIEF_STATUS.md`](./BRIEF_STATUS.md) · Gaps: [`GAPS_BACKLOG.md`](./GAPS_BACKLOG.md)

| ID | Status |
|----|--------|
| U1 | Done† |
| U2 | Done† |
| U3 | Done |
| U4 | Done† |
| U5 | Partial (axe); **8b** eslint in [`WAVE9_NEXT.md`](./WAVE9_NEXT.md) |
| U6–U7 | Planned (Wave 9) |

Seven briefs: **U1** skeleton + empty-state pass, **U2** Cmd-K command palette, **U3** saved filter views, **U4** bulk actions, **U5** accessibility audit (WCAG AA), **U6** onboarding wizard for new orgs, **U7** tablet POS layout.

U1–U5 shipped on `main` (Waves 2–8). U6 and U7 are Wave 9. Remaining DoD gaps are tracked in `GAPS_BACKLOG.md`.

---

## Brief U1 — Skeleton loaders + empty-state pass

**Goal:** Every list page renders a designed skeleton while loading and a designed empty state (with primary CTA) when no rows exist. Eliminate spinners and "Nothing here" placeholders.

**Touch:**

- `+ client/src/components/Skeleton.tsx` — small reusable primitive (Card / Row / Avatar variants), pulse animation, respects `prefers-reduced-motion`
- `+ client/src/components/EmptyState.tsx` — illustration slot + title + body + primary CTA + optional secondary
- `~ client/src/pages/{products,customers,orders,invoices,inventory,locations,loyalty,promotions,reports,worker-logs,audit-logs}.tsx` — replace spinners with `<Skeleton>`; replace empty placeholders with `<EmptyState>`
- `~ client/src/components/import/*` — keep dialogs; just refresh placeholders inside
- `~ docs/UI_PATTERNS.md` (create) — when to use skeleton vs spinner; copy guidelines for empty-state CTAs

**Steps:**

1. Skeleton primitive accepts `count`, `variant: 'row' | 'card' | 'avatar'`; no layout shift.
2. EmptyState primitive accepts `title`, `body`, `cta: { label, href | onClick }`, optional `icon`, optional `secondary`.
3. For each list page: render skeleton when `isLoading`; render empty state when `data.length === 0 && !isLoading`.
4. Empty-state copy convention: action-oriented title ("No customers yet"), explanatory body, single primary CTA ("Import from Apple Contacts" / "Add manually").
5. Respect `prefers-reduced-motion`: skeleton pulse → static neutral.

**Out of scope:**

- Page-level redesigns.
- Animated illustrations (use simple Lucide icons).
- Toast/error consistency — that's its own pass.

**DoD:**

- Every page in `Touch` list shows skeleton on load.
- Every page shows a designed empty state when no rows.
- Zero `<Loader2 className="animate-spin" />` patterns left on the listed pages (`grep` confirms).
- `prefers-reduced-motion: reduce` removes the pulse.

**Verification:**

- Manual: throttle network in DevTools → skeletons render; truncate dataset → empty states render.
- `grep -r "Loader2" client/src/pages` returns no matches on touched pages.

**PR title:** `feat(ui): skeleton loaders + designed empty states across list pages`

---

## Brief U2 — Cmd-K command palette

**Goal:** Global keyboard shortcut (Cmd-K / Ctrl-K) opens a fuzzy-search palette: jump to product, customer, order, page, or run a quick action.

**Touch:**

- `~ package.json` — add `cmdk`
- `+ client/src/components/CommandPalette.tsx` — `cmdk` wrapper; sections for Pages, Customers, Products, Orders, Actions
- `+ client/src/lib/commandPaletteIndex.ts` — builds a fuzzy index from cached query data (TanStack Query cache reads — no extra API calls)
- `+ client/src/hooks/useGlobalShortcut.ts` — registers Cmd/Ctrl-K, ignores when typing in inputs
- `~ client/src/components/Layout.tsx` — mount palette + register shortcut
- `~ shared/commandPaletteActions.ts` — declarative actions list (`"Create order"`, `"Add product"`, `"Open today's Z-report"`, etc.) with route + role gating

**Steps:**

1. Palette reads from in-memory TanStack Query caches (`useQueryClient().getQueriesData(...)`); fallback to API hit on first open if empty.
2. Fuzzy match via cmdk's built-in scorer.
3. Sections: **Jump to page** (top 6 routes), **Customers** (top 10 by recency), **Products** (top 10 by sales), **Orders** (last 10), **Actions** (declarative).
4. Each result shows a tiny icon + label + subtle subtext (e.g., customer email).
5. Selecting navigates via `wouter`'s `setLocation` or runs the action's `onSelect`.
6. Recent selections tracked in `localStorage` (per-user) and prioritised.

**Out of scope:**

- Server-side search index. Local fuzzy is enough at this scale.
- Voice search.
- Templates / snippets.

**DoD:**

- Cmd-K opens palette anywhere in the app; works on Mac (`⌘`) and Windows/Linux (`Ctrl`).
- Typing 3+ chars returns relevant results across all sections within 100ms.
- Selecting a route navigates; selecting an action runs.
- Esc closes; click-outside closes.
- Doesn't fire while typing in inputs / textareas.

**Verification:**

- Manual: open on every major page; search known customer name; navigate.
- Vitest: shortcut hook unit test (ignore in inputs).

**PR title:** `feat(ui): Cmd-K command palette with fuzzy jump`

---

## Brief U3 — Saved filter views

**Goal:** On customers / products / orders list pages, let users save a named combination of filter + sort and default to a chosen view per user.

**Touch:**

- `+ migrations/030_saved_views.sql` — `saved_views (id uuid pk, user_id varchar(255), org_id uuid, page varchar(32), name varchar(120), filters jsonb, sort jsonb, is_default boolean default false, created_at)` with unique index `(user_id, org_id, page, name)`
- `~ shared/schema.ts`
- `+ server/routes/savedViews.ts` — CRUD scoped by user + org + page
- `+ client/src/hooks/useSavedViews.ts`
- `+ client/src/components/ViewSelector.tsx` — dropdown: Saved / Default / Save current / Manage views
- `~ client/src/pages/{customers,products,orders}.tsx` — integrate; filters + sort state syncs from selected view; "Save view" captures current state

**Steps:**

1. View state shape per page is a thin `{ filters: Record<string, unknown>, sort: { column, direction } }`.
2. `Save view` dialog: name + optional "Set as default".
3. Selecting a view applies its state. URL query string still updates (deep-link-friendly).
4. Manage views modal: rename, delete, set default.
5. On page load: if a default exists for the user+page, apply it (unless URL has explicit overrides).
6. Migrations idempotent.

**Out of scope:**

- Shared / team-wide views (per-user only).
- Auto-suggest "smart" views.
- Filter UX redesign.

**DoD:**

- Save a view on customers page → reload → default view applied.
- Switch view → filters + sort update visibly + URL updates.
- Manage views: rename + delete work; deleting the default falls back to "All".

**Verification:**

- Vitest: hook serialises/deserialises view state correctly.
- Manual: cross-user — User A's views invisible to User B.

**PR title:** `feat(ui): saved filter views on customers / products / orders`

---

## Brief U4 — Bulk actions on list pages

**Goal:** Multi-select rows on customers / products / orders → action bar appears → Delete / Tag / Export / Change category (where applicable) → confirm.

**Touch:**

- `~ client/src/pages/customers.tsx` — checkbox column + bulk-bar
- `~ client/src/pages/products.tsx` — same
- `~ client/src/pages/orders.tsx` — bulk export + bulk tag only (no delete on orders)
- `+ client/src/components/BulkActionBar.tsx` — sticky bar shown when `selected.length > 0`
- `+ client/src/components/ConfirmDestructive.tsx` — typed-confirm pattern ("type DELETE to confirm")
- `~ server/routes/{customers,products,orders}.ts` — `POST /api/<entity>/bulk` accepting `{ ids[], action, payload }`; per-action authorisation
- `+ shared/bulkActions.ts` — action registry per entity with allowed roles + confirm rules

**Steps:**

1. Each list row gets a checkbox; header has select-all-visible + select-all-matching (for big result sets).
2. Action bar shows count + applicable actions (computed from role + entity + registry).
3. Destructive actions use `ConfirmDestructive` (typed-text confirm; cannot be muscle-memory clicked).
4. Server endpoint runs in a single transaction; partial failures rolled back; response returns per-id status.
5. Every bulk action writes one `admin_audit_logs` row with `{ action: 'bulk.delete', target_type: 'customer', count, ids[] }` (avoid 1000-row audit floods — one entry per bulk operation).
6. CSV export streams via `res.write` for large sets.

**Out of scope:**

- Bulk import (existing import flow handles that).
- Bulk merge of duplicate customers (own brief).
- Async / background bulk jobs (in-process for now; revisit at 10k+ rows).

**DoD:**

- Select 50 customers → delete → confirmation requires typed "DELETE" → all 50 gone → 1 audit row.
- Bulk export downloads CSV with the selected subset.
- Cashier role can't see destructive actions in the bar.

**Verification:**

- Vitest: bulk endpoint authorisation, transactionality.
- Manual: select-all-matching across page boundary works.

**PR title:** `feat(ui): multi-select bulk actions on list pages`

---

## Brief U5 — Accessibility audit (WCAG AA)

**Goal:** Pass automated + targeted manual WCAG AA checks across the deployed app. Fix keyboard reachability, ARIA labels, contrast, and motion preferences.

**Touch:**

- `~ package.json` — add `@axe-core/playwright`, `eslint-plugin-jsx-a11y`
- `~ .eslintrc` (or equivalent) — enable `jsx-a11y/recommended`
- `~ client/src/**` — fix lint findings; add ARIA labels to icon-only buttons; verify focus rings on every interactive primitive
- `~ client/src/index.css` (or theme tokens) — ensure shadcn variants meet 4.5:1 text / 3:1 large; adjust as needed
- `+ tests/a11y/critical-paths.spec.ts` — Playwright + axe on POS, customers, products, orders, settings; assert zero serious/critical violations
- `~ .github/workflows/ci.yml` — add a11y job (matches Playwright pattern)
- `+ docs/ACCESSIBILITY.md` — checklist + how to run audits locally

**Steps:**

1. Lint pass first: fix all `jsx-a11y` violations (alt text, label-for, button-name, role on non-semantic elements, etc.).
2. Focus-visible audit: every interactive primitive (button, link, input, select, tab, dropdown trigger) shows a visible focus ring; tab order is logical.
3. Icon-only buttons get `aria-label`.
4. Contrast pass: run axe on every page; fix tokens until zero serious/critical contrast violations.
5. `prefers-reduced-motion: reduce` disables non-essential animations (skeletons U1, palette U2, dialog transitions).
6. Playwright a11y test: load each critical path, axe-scan, fail on serious/critical.
7. CI job runs the a11y test in parallel with other jobs.

**Out of scope:**

- Screen-reader text-to-speech parity testing (manual only; outside scope of automation).
- Full WCAG AAA pass.
- i18n / RTL (long-horizon L5).

**DoD:**

- `npm run lint` clean — no jsx-a11y warnings on touched files.
- Playwright a11y job green: zero serious / critical axe violations on POS, customers, products, orders, settings.
- Manual keyboard-only walkthrough of POS (open cart, add product, customer, pay) reaches every control without mouse.
- `prefers-reduced-motion` honoured.

**Verification:**

- `npm run test:a11y` (script added) — green.
- DevTools: emulate `prefers-reduced-motion: reduce` → no pulses.

**PR title:** `feat(a11y): WCAG AA pass + axe in CI`

---

## Brief U6 — Onboarding wizard for new orgs

**Goal:** When a new org is created, walk the owner through: org details → currency → first location → first product → first sale. Gamified completion banner on dashboard until done.

**Touch:**

- `+ migrations/031_org_onboarding.sql` — `organizations.onboarding_state jsonb default '{}'` (track steps completed)
- `~ shared/schema.ts`
- `+ server/routes/onboarding.ts` — `GET /api/onboarding`, `PATCH /api/onboarding/step` (idempotent)
- `+ client/src/pages/onboarding/index.tsx` — wizard host with progress indicator
- `+ client/src/pages/onboarding/steps/{org,currency,location,product,first-sale,done}.tsx`
- `~ client/src/pages/dashboard.tsx` — completion banner until all 5 steps done
- `~ client/src/contexts/OrgContext.tsx` — surfaces `onboardingState` and `isOnboardingComplete`

**Steps:**

1. New-org creation flow (SUPER_ADMIN's `POST /api/orgs`) auto-sets the user's `activeOrgId` and routes them to `/midnight/onboarding`.
2. Wizard steps: 1) Org name + logo + timezone → 2) Currency (preset list with symbols) → 3) Create first location → 4) Add first product (SKU + price) → 5) Place a £0.01 test sale (auto-refunded) → 6) Done screen with "What's next" CTAs.
3. Each step `PATCH /api/onboarding/step` with `{ step: 'currency', completed: true }` and idempotent server-side update.
4. Steps survive refresh; skipping returns to last incomplete step.
5. Dashboard banner: "Finish setting up your shop (4 of 5 done) → Resume". Hides when complete.

**Out of scope:**

- Onboarding for additional users invited to an existing org.
- White-glove / video walkthroughs.
- Multi-org wizard.

**DoD:**

- New-org creation lands the owner on step 1.
- Closing the tab mid-wizard and re-opening resumes at last incomplete step.
- Once all 5 steps complete, banner disappears and dashboard renders normally.
- State is server-truth; localStorage is hint-only.

**Verification:**

- Vitest / Playwright: full happy path of a new-org creation.
- Manual: deliberately abandon at step 3, re-login, banner shows "Resume" → step 3.

**PR title:** `feat(onboarding): new-org wizard + dashboard completion banner`

---

## Brief U7 — Tablet POS layout optimisation

**Goal:** POS page works first-class on iPad Pro 11" landscape: large touch targets, grid + cart side-by-side, bottom drawer for cashier actions.

**Touch:**

- `~ client/src/pages/pos.tsx` — responsive landscape layout via Tailwind `lg:` / `xl:` + container queries
- `+ client/src/pages/pos/components/{ProductGrid,CartPanel,ActionDrawer}.tsx` — extracted, tablet-aware
- `~ client/src/index.css` — touch-target sizing tokens (min 44×44 per WCAG)
- `+ tests/visual/pos-tablet.spec.ts` — Playwright snapshot at 1194×834 (iPad Pro 11")

**Steps:**

1. Layout: left ~62% product grid, right ~38% cart, bottom 96px action drawer (pay / hold / new customer / scan).
2. Product grid: 3-column at < 1024px landscape, 4-column at 1194×834, 5-column at desktop.
3. Touch targets: 44×44 minimum; spacing between rows ≥ 8px.
4. Disable hover-only affordances (long-press equivalents where needed).
5. Visual regression snapshot at iPad Pro 11"; future PRs that change the POS visual will be flagged.

**Out of scope:**

- iPad portrait mode (defer; cashier uses landscape).
- iOS-specific PWA install banner.
- Stylus / Apple Pencil flows.

**DoD:**

- iPad Pro 11" landscape: cart, grid, drawer all visible without scroll; touch targets pass automated WCAG check.
- Desktop 1440×900 layout unchanged or improved.
- Snapshot test passes; visible-only diffs in PR.

**Verification:**

- Playwright at 1194×834 viewport.
- Manual: real iPad Pro 11" (or Safari Responsive Design Mode) — pay flow completes without zooming.

**PR title:** `feat(pos): tablet-optimised landscape layout (iPad Pro)`
