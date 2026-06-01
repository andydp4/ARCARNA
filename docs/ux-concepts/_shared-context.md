# UX concepts — shared context

## Brand (mandatory)

Use **only** official logo files in `client/public/brand/`:

- `midnight-logo-navy-on-white.png`
- `midnight-logo-white-on-navy.png`

Do **not** redraw, approximate, or “improve” the mark in code, CSS, SVG, or AI mockups. M-hull / orbit shapes may echo logo geometry as **layout** inspiration; the rendered logo asset is fixed.

## Approved direction

**Liquid Metal Industrial** — canonical brief: [`MIDNIGHT_UX_REDESIGN_BRIEF.md`](./MIDNIGHT_UX_REDESIGN_BRIEF.md).

Concept E (“Aurora”) in this folder describes the **spatial workspace** expression of that direction (core + satellites), not a separate cyan/sci-fi theme.

## Base path

Production app: `https://viger.cloud/midnight` — all routes and assets must respect `VITE_BASE_PATH=/midnight`.

## Feature flags

In-progress UI ships behind per-org flags (`useFlag`, `shared/featureFlags.ts`). Spatial workspace: `spatialWorkspace`.
