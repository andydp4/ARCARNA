# UX concepts — shared context

## Brand (mandatory)

Use **only** official logo files in `client/public/brand/`:

- `arcarna-mark.png` — A icon for favicon, PWA icons, collapsed nav
- `arcarna-wordmark.png` — full wordmark for auth shells, portal, expanded sidebar

Do **not** redraw, approximate, or “improve” the mark in code, CSS, SVG, or AI mockups. M-hull / orbit shapes may echo logo geometry as **layout** inspiration; the rendered logo asset is fixed.

## Approved direction

**Liquid Metal Industrial** — canonical brief: [`ARCARNA_UX_REDESIGN_BRIEF.md`](./ARCARNA_UX_REDESIGN_BRIEF.md) (formerly `MIDNIGHT_UX_REDESIGN_BRIEF.md`).

Concept E (“Aurora”) in this folder describes the **spatial workspace** expression of that direction (core + satellites), not a separate cyan/sci-fi theme.

## Base path

Production app: `https://viger.cloud/arcarna` — all routes and assets must respect `VITE_BASE_PATH=/arcarna`. Legacy `/midnight` redirects with 301.

## Feature flags

In-progress UI ships behind per-org flags (`useFlag`, `shared/featureFlags.ts`). Spatial workspace: `spatialWorkspace`.
