# PR1: POS Checkout UX Hardening

**Branch:** `phase3/order-entry-pr1` → `main`

## Summary
Phase 3 PR1: POS checkout UX hardening. Client-only, no API changes.

## Changes
- **Checkout disabled when cart empty**: Checkout button has `disabled={cart.length === 0}`, `title="Add items to cart"` tooltip, and `aria-label` for accessibility
- **Cart count badge**: Total item count (sum of quantities) shown in cart header (`Shopping Cart (3)`), mobile FAB badge, and mobile quick actions bar
- **processPayment guard**: Early return when `cart.length === 0` – no API calls fire
- **Confirm Payment disabled**: Dialog button also disabled when cart empty (defense in depth)

## Acceptance Checks
- [x] Checkout buttons are disabled when cart is empty
- [x] Disabled state is accessible (`disabled` + `aria-label` + `title` tooltip) with clear user-facing message
- [x] No API calls fire when cart is empty
- [x] Mobile and desktop both behave correctly (same CartPanel used in both layouts)

## Screenshots / GIFs
_Add before/after screenshots:_
- **Before:** Checkout button enabled with empty cart (or prior state)
- **After:** Checkout disabled with tooltip on hover; cart header shows count when items present; mobile FAB shows total item count badge

## CI
- `npm run check` ✓ (TypeScript passes locally)
- `npm run gate` – runs in CI (requires DATABASE_URL; workflow provides postgres)
- Confirm gate green in CI before requesting merge

## Files Changed
- `client/src/pages/pos.tsx`
