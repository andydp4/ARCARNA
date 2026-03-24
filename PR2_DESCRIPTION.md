# PR2: POS Order Entry Flow Cleanup

**Branch:** `phase3/order-entry-pr2` → `main` (or `phase3/order-entry-pr1`)

## Summary
Phase 3 PR2: POS order entry flow UX improvements. Client-only, no API or schema changes.

## Scope
- **POS page only** – `client/src/pages/pos.tsx`
- Small, focused UX and component tweaks
- No backend changes
- No RBAC, schema, or new tables

## Changes

### 1. Product Selection UX
- **Clearer product cards**: Price in primary color, larger; name and SKU hierarchy improved
- **Add button only**: Card is display-only (future-proof for detail view); only the "Add" button adds to cart — avoids double-tap adding 2 items
- **Stock state**: Badges – "Out of Stock", "Low (n)", "n left", "n in stock"
- **Touch targets**: 44px Add button
- **Responsive grid**: Padding accounts for mobile bar + safe area

### 2. Cart UX
- **Labels (no fake wizard)**: "Add items", "Review cart", "Choose payment", "Confirm order" — guidance without fake step sequencing
- **Empty cart**: Icon + "Your cart is empty" + "Tap a product to add it"
- **Cart header**: "Cart" with item-count badge when non-empty
- **Order summary**: Distinct card with "Order Summary" title
- **Quantity controls**: Grouped; min=1 enforced; no NaN/negative/empty leading to broken totals
- **Checkout CTA**: "Checkout" (primary) with optional subtext "Choose payment"

### 3. Checkout Flow
- **Dialog**: "Choose payment" + "Complete Order" — no Step X of Y
- **PR1 guards**: Disabled states and `aria-label` preserved

### 4. Mobile
- **Safe area**: `env(safe-area-inset-bottom)` on FAB and quick bar so buttons stay above home indicator
- **Content padding**: Products grid uses `max(6rem, calc(5rem + env(safe-area-inset-bottom)))` on mobile
- **Quick bar**: Total + "Review" + "Checkout"; no overlap with keyboard open

### 5. Quantity Validation
- **Empty string**: Resets to current value (no silent 0)
- **Invalid (NaN, negative, &lt; 1)**: Resets + toast "Enter 1 or higher"
- **Explicit 0**: Removes item

## Pre-merge Fixes Applied
1. Removed "Step X of Y" — labels now: Add items, Review cart, Choose payment, Confirm order
2. Option A: Card no longer adds on click; Add button only
3. Checkout CTA: "Checkout" with subtext "Choose payment" when cart has items
4. Mobile: safe-area-inset-bottom on FAB, quick bar; grid padding pushes content
5. Quantity: min=1, no NaN, no negative, no empty→0 silently

## Files Changed
- `client/src/pages/pos.tsx`

## Acceptance Criteria
- [x] No backend changes
- [x] No new routes
- [x] Cart flow clearer on desktop and mobile
- [x] Add-to-cart = single interaction (Add button only)
- [x] `npm run check` green

## CI / Gate
- `npm run check` ✓
