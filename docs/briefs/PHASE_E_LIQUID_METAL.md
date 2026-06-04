# Phase E — Liquid Metal Industrial (design system + spatial shell)

**Status (2026-06-04):** **E1, E3 Done** · **E2 Done†** (Layout/POS; remainder: [`GAPS_BACKLOG.md`](./GAPS_BACKLOG.md#gap-e2-01))

**Canonical UX spec:** [`../ux-concepts/MIDNIGHT_UX_REDESIGN_BRIEF.md`](../ux-concepts/MIDNIGHT_UX_REDESIGN_BRIEF.md)  
**Spatial notes:** [`../ux-concepts/concept-E-aurora.md`](../ux-concepts/concept-E-aurora.md)

Execute **E1** before wide U1 rollout so polish passes use the same tokens.

---

## Brief E1 — Design tokens + spatial workspace (Insights)

**Goal:** Introduce Liquid Metal design tokens and an optional spatial Insights shell (core + deck + satellites) behind `spatialWorkspace`, without reskinning every page.

**Touch:**

- `+ client/src/styles/tokens/liquid-metal.css` (or extend `index.css`) — CSS variables: graphite base, gunmetal surfaces, brushed highlight, amber/emerald/crimson status, minimal electric blue
- `~ tailwind.config.ts` — map tokens to Tailwind theme extensions
- `~ client/src/index.css` — dark-mode-first defaults
- `+ client/src/components/spatial/HullPanel.tsx`
- `+ client/src/components/spatial/DeckLayer.tsx`
- `~ client/src/pages/insights.tsx` — when `useFlag('spatialWorkspace')` or `?spatial=1`, render spatial layout
- `~ docs/ux-concepts/README.md` — link mockups
- Logo: use only `client/public/brand/*.png`

**Steps:**

1. Tokens documented in `MIDNIGHT_UX_REDESIGN_BRIEF.md` — implement as CSS vars + Tailwind.
2. Customise shadcn primitives (Card, Button, Table) for machined surfaces — one reference page first (Insights).
3. `DeckLayer`: subtle grid, node markers, optional dependency arcs — no particles/starfield.
4. `HullPanel`: navy/metal frame; official logo in header slot only.
5. Gate with `useFlag('spatialWorkspace')`; default off in production until QA sign-off.
6. Mobile: stack satellites below core; bottom-nav unchanged until U7.

**Out of scope:**

- Full POS/tablet reskin (U7)
- Framer Motion beyond subtle panel transitions
- Replacing brand logo with CSS-drawn mark

**DoD:**

- With flag on, Insights shows spatial shell matching brief mood (screenshot in PR).
- With flag off, current Insights unchanged.
- `npm run check`, `npm run build` green.
- Lighthouse contrast spot-check on Insights (WCAG AA target).

**Verification:**

- Toggle flag in Settings → Flags.
- Open `/insights?spatial=1` on mobile width — no horizontal scroll.

**PR title:** `feat(ui): Liquid Metal tokens + spatial Insights shell (E1)`

---

## Brief E2 — Token rollout to shell + POS (follow-up)

**Goal:** Apply Liquid Metal tokens to `Layout`, navigation, and POS high-priority flows per redesign brief.

**Touch:** `Layout.tsx`, `pos.tsx`, shared Button/Card variants, mobile touch targets ≥ 44px.

**Depends on:** E1 merged.

**PR title:** `feat(ui): Liquid Metal shell and POS surfaces (E2)`

---

## Brief E3 — PWA polish (optional, can merge with U work)

**Goal:** Installable PWA meets redesign brief: splash, icons, standalone, offline shell.

**Cross-ref:** Parent brief PWA section; existing `client/public/sw.js`.

**PR title:** `feat(pwa): Liquid Metal install experience`
