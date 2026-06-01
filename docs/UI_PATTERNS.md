# UI patterns — loading & empty states

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
