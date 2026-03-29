# PR 4A-1: POS performance & perceived load (client-only)

## Scope

- **POS page only** (`/pos`): reduce wasted work when cart and other local state change, fix cart subtree remounting, replace generic product loading text with layout-matched skeletons, one mobile safe-area tweak for bottom-fixed controls.
- No backend, routes, schema, or RBAC changes. No new npm dependencies.

## Profiler-style analysis (subtrees addressed)

1. **Product grid (`filteredProducts.map` → many `Card`s)**  
   **Why hot:** Any `setCart`, checkout prep, promo/customer state, etc. re-rendered the whole POS tree and **rebuilt every product card**, even though product rows only depend on `product` + `addToCart`.  
   **What we did:** `useMemo` on the filtered list (stable array ref when `products` + `searchTerm` unchanged). Extracted **`PosProductCard`** with **`React.memo`** and a **stable `addToCart`** via **`useCallback`** so cart-only updates skip re-rendering tiles.

2. **Cart panel (`CartPanel` defined inside `POS`)**  
   **Why hot / buggy:** A new function component identity every parent render makes React **tear down and remount** the cart subtree (focus, scroll, and unnecessary work).  
   **What we did:** Moved UI to module-level **`PosCartPanel`** with explicit props (stable component type).

3. **Initial product load**  
   **Why jumpy:** A single centered “Loading products…” string did not match the final grid height.  
   **What we did:** **`PosProductGridSkeleton`** — same grid columns, **`min-h-[188px]`** per cell, skeleton blocks aligned to title / SKU / price / badge / button regions (no spinner).

4. **Mobile (one targeted fix)**  
   **What we did:** FAB and quick-checkout bar use **`env(safe-area-inset-bottom)`** so bottom-fixed UI clears the home indicator on notched devices.

## Files changed

| File | Change |
|------|--------|
| `client/src/pages/pos.tsx` | `useMemo`/`useCallback`; skeleton grid; `PosProductCard` + `PosCartPanel`; safe-area classes; removed unused `updateCustomPrice` |
| `client/src/components/pos-product-card.tsx` | **New** — memoized product tile + local price/stock badge helpers |
| `client/src/components/pos-cart-panel.tsx` | **New** — cart UI extracted from page (stable mount) |

## What we did *not* do (guardrails)

- No blanket `React.memo` / `useCallback` across the tree — only **`PosProductCard`** + **`addToCart`** (+ **`handleCheckout`** for a stable prop into the panel).
- No generic spinner swap without layout structure.

## Screenshots / GIFs

_Add (manual):_ POS with skeleton grid during load; POS after load; mobile showing FAB + quick bar above safe area.

## CI / gate

- `npm run check` — green  
- `npm run gate` — green (check-only without `DATABASE_URL`)

## Next

- **4A-2:** Orders list/render stability  
- **4A-3:** Reporting / invoices loading + lists  
- **4B:** Visual design pass  
