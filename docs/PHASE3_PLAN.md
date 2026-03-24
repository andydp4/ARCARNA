# Phase 3: UI Overhaul Plan

UI-first roadmap. **No schema/RBAC changes** unless strictly required by UX or bug fixes.

## Gates (Non-Negotiable)

- **Gate green** = full `npm run gate` in CI stays green on every PR. If it goes red, stop and fix in that PR.
- Work in feature branch `phase3/ui-overhaul`; keep PRs small.
- See [PHASE3_RULES.md](./PHASE3_RULES.md) for route/table rules.
- New backend routes: use [ROUTE_TEMPLATE.md](./ROUTE_TEMPLATE.md) (scoped-by-default).

## Backend Change Rules

Keep Phase 3 PRs **client-only** unless UX is blocked. If a backend change is required:

- Must use scoped middleware by default for any new route
- Must not introduce unscoped queries
- Must not add new tables unless `orgId` is included and `NOT NULL` (unless explicitly platform/global)

## Roadmap Order

1. **Order entry flow** (POS + checkout)
2. **Admin screens** (locations, user-access, settings)
3. **Reporting screens** (analytics, expense-reports, insights)

---

## 1. Order Entry Flow (First)

### Current State

- **POS** (`client/src/pages/pos.tsx`): Product grid, cart, customer picker, promo codes, loyalty discount, order expenses, checkout
- **Orders** (`client/src/pages/orders.tsx`): List, status filter, detail/edit/delete dialogs
- API: `POST /api/orders`, `GET/PATCH /api/orders/:id`, `PATCH /api/orders/:id/status`

### Goals (Data + UX)

- Clearer cart → checkout flow
- Faster add-to-cart (tap/click path)
- Better mobile layout for POS (existing `useIsMobile`)
- Order creation feedback (success/offline/warnings)
- No styling refactors beyond what’s necessary for UX

### Out of Scope (This Phase)

- Schema changes (orders, order_items, order_expenses)
- RBAC changes
- New backend routes (unless required)
- Visual redesign beyond layout/UX tweaks

---

## 2. Admin Screens (Second)

- **Locations** – CRUD, org-scoped
- **User Access** – Allowed users, roles, org assignment
- **Settings** – Org/store config

### Goals

- Consistent table/form patterns
- Clear role/org visibility in user management

---

## 3. Reporting Screens (Last)

- **Analytics / Insights** – Charts, top customers, daily revenue, monthly summary
- **Expense Reports** – Overhead vs order expenses, profit
- **Invoices** – List, PDF generation

### Goals

- Date range and org scope clearly exposed
- Export/print where useful

---

## PR Strategy

- One PR = one focus. No drive-by refactors.
- Fix CI failures in the same PR before merging.
- Include screenshots/GIFs for before/after in the PR.
- Confirm `npm run gate` green in CI before requesting merge.
- Branch: `phase3/ui-overhaul` (or `phase3/order-entry` for PR1).

---

## PR1 Outline (First Small PR)

**Branch:** `phase3/order-entry-pr1`

**Scope:** POS checkout UX hardening – disable checkout when cart empty, improve feedback.

### Changes

1. **Disable checkout when cart empty** – "Checkout" / "Process Payment" disabled when `cart.length === 0`; show tooltip or inline message "Add items to cart".
2. **Cart item count badge** – Show total item count on cart icon/trigger (e.g. "Cart (3)").
3. **No schema, no new routes** – Client-only.

### Acceptance Checks

- [ ] Checkout buttons are disabled when cart is empty
- [ ] Disabled state is accessible (`aria-disabled` or `disabled`) and has a clear user-facing message
- [ ] No API calls fire when cart is empty
- [ ] Mobile and desktop both behave correctly

### Files Likely Touched

| File | Change |
|------|--------|
| `client/src/pages/pos.tsx` | Disable checkout button when cart empty; add cart count; guard processPayment from empty cart |

### Risks / Blockers

- **Risk:** None expected. Client-only, no API changes.
- **Blocker:** None. Gate should stay green.
