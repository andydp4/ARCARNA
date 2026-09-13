# UI patterns — loading, empty states & interaction

## Skeleton vs spinner

| Use | When |
|-----|------|
| **`<Skeleton>`** (`client/src/components/Skeleton.tsx`) | List pages, tables, and cards while the first page of data loads. Keeps layout stable (row / card / avatar variants). |
| **Spinner (`Loader2`, border spinners)** | Short inline actions only: form submit, dialog refetch, button `pending` — not whole list pages. |
| **Page-specific skeletons** | Large layouts (orders, invoices) may compose `SkeletonBar` + cards; prefer the shared primitive for simple lists. |

Skeleton pulse uses `animate-pulse` and turns off under `prefers-reduced-motion: reduce` (`motion-reduce:animate-none`).

## Empty states

Use **`<EmptyState>`** (`client/src/components/EmptyState.tsx`) when `data.length === 0 && !isLoading`.

Copy convention:

1. **Title** — action-oriented, present tense (“No customers yet”).
2. **Body** — one sentence on what will appear or what to do next.
3. **Primary CTA** — single main action (`cta: { label, href | onClick }`).
4. **Secondary** (optional) — alternate path (e.g. import vs add manually).

For filter/search with no matches, keep the page chrome and show empty state inside the list area; distinguish “no data at all” vs “no matches” in title/body.

**`<EmptyStatePanel>`** remains for variant styling (`empty` / `filtered` / `search`) where pages already use it; new list work should prefer `<EmptyState>` when a CTA is required.

## List page checklist

1. `isLoading` (or `isPending && data === undefined`) → skeleton in the list region (or full-page skeleton for complex layouts).
2. Loaded + zero rows → `<EmptyState>` with icon + CTA where applicable.
3. No `Loader2` + `animate-spin` on the list body for initial load.

## Inline expanding panel instead of a Dialog

**Use this, not a Radix `Dialog` / `Sheet` / `Popover`, for a short form or
confirmation that must stay reachable from a context where a real dialog
either can't mount (a phone tab that has to prove `[role=dialog]` count 0 —
see `tests/journeys/operationsPhone.spec.ts`) or would fight for focus/scroll
with the surface that opened it. Established by the Operations Centre
(`docs/briefs/PHASE_N_OPERATIONS_CENTRE.md`, N4a/N6) and now the codebase's
default for this exact constraint, not a one-off:

- **`OpsDelayInline.tsx`** — the delay editor on an order card (cause chips,
  +10/+20/+30/pick, "customer told" switch).
- **`OpsPassMenu.tsx`** — the staff strip for handing an order to someone
  else.
- **`OpsRateChips.tsx`** — the 1–5 satisfaction rating on a completed card.
- **`OpsCardActions.tsx`** — on a board card (Collection/Delivery lanes, any
  layout, not the Order tab): a `DropdownMenu` is still the overflow
  trigger itself ("More actions"), but picking Pass / Assign / Hold / Delay
  from it opens one of these inline panels (`togglePanel`) rather than a
  Dialog.
- **`NewCustomerPanel`** (`pos-cart-panel.tsx`) — "Add a new customer",
  replacing `NewCustomerDialog` once the customer picker became reachable
  from the embedded order form.
- The loyalty "Redeem points" panel and `OpsShiftControls`'s "Z-report so
  far" / "Close shift" (both `pos.tsx` / `OpsShiftControls.tsx`) — moved out
  of Dialogs for the same reason once N6 embedded the order form in the
  phone's New order tab.

**Shape:** a plain expanding `<div>`, toggled by local state in the parent —
not a portal, not a focus trap of its own, not `aria-modal`. A `DropdownMenu`
may still trigger it (as `OpsCardActions` does, for its overflow menu), but
the trigger itself doesn't switch shape by viewport width — only what it
opens does. It renders inline in the surrounding layout (pushing
content below it down) rather than overlaying anything, so there is nothing
to click outside of and nothing fighting the page for scroll or focus.
Closing is an explicit Cancel/Save action or the same toggle that opened it
(`OpsCardActions`'s `togglePanel` re-closes on a second click of the same
menu item) — never an overlay-click or `Escape`-on-outside-focus pattern a
real dialog gets for free; wire `Escape` yourself if a given control needs
it.

**When a real Dialog/Sheet is still right:** anything that must interrupt the
whole page (destructive confirmation with no safe inline placement, a
full-height detail view like `OpsDetailsSheet` on desktop) and is never
reachable from a context with a no-dialog constraint. If in doubt, check
whether the surface you're adding this to can be reached from
`/operations?pane=order` at phone width — if it can, use the inline pattern.
