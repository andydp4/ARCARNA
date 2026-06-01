# Concept E — Aurora (spatial workspace)

**Parent direction:** [Liquid Metal Industrial](./MIDNIGHT_UX_REDESIGN_BRIEF.md)  
**Status:** Selected spatial/layout expression — **not** a separate cyan sci-fi theme.

---

## What “Aurora” means here

- **Core-centred layout** on Insights (and optionally other hubs): operational “core” with **satellite** panels (settings, variables, dependencies, alerts).
- **Interactive deck** — grid, nodes, dependency arcs (no starfield/particle HUD).
- **Shape vocabulary:** M-hull (layout echo of logo, not logo replacement), rings, wedges, triangles, hex — subtle **thruster** motion (bob, lift, under-glow).
- **Palette:** navy + liquid metal per parent brief — **no** cyan overload, no vaporwave.

---

## Implementation (Phase E1)

| Piece | Notes |
|-------|--------|
| `HullPanel` | Framed core region |
| `DeckLayer` | Grid + nodes behind/around core |
| `?spatial=1` | Dev/preview entry |
| `useFlag('spatialWorkspace')` | Per-org rollout |

See [`../briefs/PHASE_E_LIQUID_METAL.md`](../briefs/PHASE_E_LIQUID_METAL.md).

---

## Mockups

- `mockups/concept-E-aurora-pos-v3.png` — industrial POS (preferred)
- `mockups/concept-E-aurora-insights.png` — insights / deck
- Legacy cyan mockups are **obsolete** — do not use as colour reference.

---

## Out of scope for E1

- Full app reskin (that's U1–U7 + token rollout)
- Replacing logo with drawn SVG hull as brand mark
- Neon particles, starfield, gamer RGB
