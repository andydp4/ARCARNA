# Phase 4 End + 5A + 5B Review Update

Date: 2026-03-24  
Branch context: `main` working tree (`fvd`) with uncommitted review bundle

## Executive status

- Phase 4 (end-state polish on core operational screens) is implemented in client code and validated locally.
- Phase 5A (mutation/invalidation cleanup) is implemented for the targeted operational flows using explicit endpoint-family invalidation helpers.
- Phase 5B (safe optimistic UX for POS + Orders) is implemented for high-confidence actions with rollback and duplicate-click prevention.
- `npm run check` and `npm run gate` pass in this state.

## What is included

### Phase 4 end (visual polish continuity)

Primary surfaces:
- `POS`
- `Orders`
- `Invoices`
- `Insights`

Shared polish updates:
- `client/src/components/app-page-header.tsx`
- `client/src/components/data-table-shell.tsx`
- `client/src/components/empty-state-panel.tsx`
- `client/src/components/action-loader.tsx`
- skeleton alignment updates in:
  - `client/src/components/orders-skeleton.tsx`
  - `client/src/components/reporting-skeletons.tsx`

Outcome:
- More consistent header rhythm, control bars, action feedback treatment, table shell behavior, and empty/skeleton presentation across touched pages.

### Phase 5A (mutation audit + targeted invalidation)

New helper:
- `client/src/lib/query-invalidation.ts`
  - `invalidateEndpointFamily(queryClient, endpoint)`
  - `invalidateOperationalData(queryClient, options?)`

Integrated into:
- `client/src/pages/pos.tsx`
- `client/src/pages/orders.tsx`
- `client/src/pages/invoices.tsx`
- `client/src/pages/inventory.tsx`
- `client/src/pages/product-management.tsx`

Key cleanup performed:
- Replaced brittle single-key invalidations (for endpoint families) with predicate-based family invalidation.
- Ensured operational mutations reconcile dependent families (`orders`, `products`, `inventory`, `invoices`, `reports`, `analytics`) with tighter intent.
- Removed legacy mismatched invalidation key usage (`"order-details"` style no longer present).

### Phase 5B (optimistic UX for POS + Orders)

Orders:
- Added optimistic status mutation updates for:
  - list cache (`/api/orders`)
  - detail cache (`/api/orders/:id`)
- Added rollback on error using snapshot from `onMutate`.
- Preserved server reconciliation via targeted invalidation.

POS:
- Kept cart interactions local/immediate.
- Hardened checkout-adjacent mutation UX:
  - disabled conflicting cart/product/customer/promo interactions while order submit is in-flight
  - blocked duplicate submit paths and rapid conflicting edits during pending mutation
  - kept clear pending feedback via action loaders

Components touched for 5B behavior:
- `client/src/components/pos-product-card.tsx`
- `client/src/components/pos-cart-panel.tsx`
- `client/src/pages/pos.tsx`
- `client/src/pages/orders.tsx`

## Validation status

Executed in `fvd`:
- `npm run check` -> pass
- `npm run gate` -> pass (check-only mode; DB-backed Phase 2D checks skipped without `DATABASE_URL`)

## Open issues / review flags

These are not blockers for review but should be explicitly acknowledged:

1. Scope bundling is broad
- Current working bundle contains Phase 4-end visual touches + Phase 5A + Phase 5B behavior changes together.
- Reviewer impact: harder to isolate regression cause by phase unless split or clearly reviewed by section.

2. Existing optimistic behavior already present in Inventory
- `client/src/pages/inventory.tsx` already had optimistic `onMutate` behavior before this pass.
- 5A alignment updated invalidation around it, but this means optimism now exists outside strict 5B target pages.

3. Endpoint-family invalidation is intentionally broad by domain
- Family predicates are deliberate to fix stale sub-key issues (`/api/analytics/*`, `/api/reports/*`), but they can trigger more refetches than exact-key invalidation.
- Tradeoff: correctness and consistency over ultra-minimal churn.

4. Offline paths remain queue-first for some flows
- Offline success branches still depend on later sync for final server truth.
- UI messaging is present, but audit should confirm operator expectations around delayed reconciliation.

## Reviewer checklist (recommended)

- Confirm POS submit-in-flight lock behavior does not block intended non-conflicting actions.
- Confirm Orders optimistic status update always rolls back correctly on forced failure.
- Confirm cross-screen freshness after:
  - POS order completion
  - order status/edit/delete
  - invoice regenerate
  - inventory/product stock-affecting updates
- Confirm no stale views remain in:
  - Orders list/detail
  - POS product availability
  - Invoices list
  - Insights/Reports charts/tables

## Suggested next step after review

- If this passes review, split commit history (or PR notes) by section:
  1. Phase 4-end visual parity
  2. Phase 5A invalidation model
  3. Phase 5B optimistic UX
- Then proceed to 5C freshness alignment with current helper model as the baseline.
