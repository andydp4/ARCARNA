# ARCARNA™ Design System Specification

> **Agent 4 — Design System Architect.** Subordinate to
> [`ARCARNA_FOUNDATION_SPECIFICATION.md`](./ARCARNA_FOUNDATION_SPECIFICATION.md). **Owns** tokens,
> colour, type, spacing, elevation, motion, and the colour-as-meaning law.
>
> **Direction (owner-approved): Liquid Metal — Refined.** Do **not** replace the Liquid Metal
> visual language — **refine** it. Remove decorative chrome, excessive gradients, and unnecessary
> shine; **retain the premium forged-industrial material language**. Introduce **Truth Blue** as the
> semantic accent for **insights, actions, selection, and understanding**.
>
> **Core principle:** *Darkness is the canvas. Truth is the light. Understanding is the destination.*
> The canvas is **forged metal (the craft)**; the light is **Truth Blue (the revelation)**. Together
> they express the brand promise: **Reveal Your Truth™.**
>
> **Current code:** the implemented theme is Liquid Metal (`liquid-metal.css`, `lm-*` tokens). This
> spec **keeps and refines** it (it is not torn out) and **adds** Truth Blue. The gap is the
> reduction of decorative shine + the Truth Blue accent layer; recorded in the Compliance Report.

---

## 1. Design philosophy

The interface is **forged dark metal** — machined, weighty, premium, calm. That material *is* the
brand's craftsmanship and it stays. What changes:

- **Refine, don't strip.** Remove the *decorative* chrome: glossy highlights, excessive multi-stop
  gradients, mirror-shine on buttons, edge-light on every surface. Keep restrained material depth so
  surfaces still read as forged metal, not flat cards.
- **Truth Blue is the light.** A single semantic accent that means *insight / action / selection /
  understanding*. Where the user should look, act, or has revealed a truth, Truth Blue appears —
  against the quiet metal, it reads as revelation.
- **Material = craft. Blue = revelation.** Never decorate with either. Metal carries structure;
  Truth Blue carries meaning; state colours carry state. Nothing on screen is there only to shine.

## 2. Token architecture

Three layers, all inside the existing `.liquid-metal` scope (single dark theme):

1. **Material tokens (retained, refined)** — `--lm-graphite`, `--lm-gunmetal`, `--lm-charcoal`,
   `--lm-smoke-chrome`, brushed/titanium/stainless metallics, refined surface gradient + reduced
   shadows. The forged palette stays; the *shine* is dialled down.
2. **Truth Blue tokens (new)** — `--truth-blue*` accent scale.
3. **Semantic / shadcn tokens** — `--background`, `--card`, `--primary`, `--ring`, `--accent`…
   mapped so surfaces = metal and **primary/selection/ring = Truth Blue**.

No component hardcodes colour; everything consumes tokens (CSS vars or Tailwind `metal-*` / `truth-*`).

## 3. Colour tokens

### 3.1 Forged-metal surfaces (retained; values unchanged, treatment refined)
| Token | Value | Role |
|-------|-------|------|
| `--lm-graphite` | `hsl(220 10% 7%)` | App background / canvas |
| `--lm-gunmetal` | `hsl(215 12% 13%)` | Card / panel |
| `--lm-charcoal` | `hsl(218 9% 17%)` | Popover, secondary, muted, inputs |
| `--lm-smoke-chrome` | `hsl(215 10% 26%)` | Raised/hover surfaces |

### 3.2 Metallic highlights & text (retained)
| Token | Value | Role |
|-------|-------|------|
| `--lm-brushed` / `--lm-brushed-highlight` | `hsl(215 8% 38%)` / `hsl(210 12% 68%)` | Hairlines, restrained detail |
| `--lm-titanium` / `--lm-stainless` | `hsl(220 6% 52%)` / `hsl(210 10% 78%)` | Neutral metal accents |
| `--lm-warm-white` | `hsl(210 18% 95%)` | Primary text |
| `--lm-muted` | `hsl(215 10% 58%)` | Secondary text |

### 3.3 Truth Blue — the semantic accent (the light / revelation)
| Token | Value | Role | Contrast |
|-------|-------|------|----------|
| `--truth-blue-bright` | `hsl(208 96% 64%)` | Revealed-truth highlight, links, active text, chart-1 — on metal | ≈7:1 on graphite |
| `--truth-blue` | `hsl(213 90% 46%)` | Primary action / button base | ≈4.9:1 with white text |
| `--truth-blue-strong` | `hsl(214 90% 39%)` | Hover / pressed |
| `--truth-blue-subtle` | `hsl(212 90% 60% / 0.14)` | **Selection**, active-nav tint, focus halo, insight fills |
| `--truth-blue-foreground` | `hsl(210 40% 98%)` | Text/icon on Truth Blue |

### 3.4 State colours (retained — meaning only)
| Token | Value | State |
|-------|-------|-------|
| `--lm-emerald` → `--success` | `hsl(158 64% 45%)` | Positive / balanced / in stock |
| `--lm-amber` → `--warning` | `hsl(38 92% 52%)` | Attention / low stock / due soon |
| `--lm-crimson` → `--danger` | `hsl(2 78% 56%)` | Destructive / overdue / out of stock |

### 3.5 Refined surface treatment (the key change)
| Token | Before (decorative) | **Refined** |
|-------|---------------------|-------------|
| `--lm-surface-gradient` | 3-stop 155° gradient (16%→10%→13%) | **2-stop, low-contrast** (`hsl(215 12% 14%) → hsl(220 10% 11%)`) — material, not glossy |
| `--lm-edge-highlight` | `…/0.14` on **every** surface | reduce to `…/0.07`; apply **only** to truly raised/floating elements |
| `--lm-inner-shadow` | inset top-light `…/0.05`–`0.22` (shine) | drop the top "shine" highlight; keep a faint bottom seat `inset 0 -1px 0 hsl(0 0% 0% / 0.22)` |
| `--lm-panel-shadow` | `0 8px 32px /0.45` | keep for floating only; soften to `0 8px 24px /0.4` |

## 4. Semantic colour rules (binding)

1. **Truth Blue = insight, action, selection, understanding.** Primary buttons, active nav, focus
   ring, links, the highlighted truth/number, selected rows, primary data series. This is the
   *revelation* layer — used deliberately, never as theming.
2. **Forged metal = surface & craft.** Backgrounds, cards, panels, secondary controls. Metal is
   structural, never used to signal meaning.
3. **State colours = state only** (success/warning/danger). Never for emphasis or theming.
4. **No decorative colour or shine** (Foundation N6). If a surface shines, it must be a genuine
   raised element; if a colour appears, it encodes a truth, an action, or a state.
5. **Never colour alone.** State and selection are reinforced by text/icon/position.

## 5. Typography rules

- **Family:** `Inter` for all product UI; mono `Menlo` for codes/IDs. No serif in chrome.
- **Weights:** 400 body, 500 labels, 600 headings, 700 hero metrics.
- **Scale:** H1 `text-2xl/3xl` 600; H2 `text-xl/2xl` 600; body `text-sm/base` `leading-relaxed`;
  metric `text-3xl` 700; eyebrow `text-xs uppercase tracking-wider` muted.
- **Numbers:** always `tabular-nums`.
- The headline **truth** is `--lm-warm-white` at large weight; its meaningful delta may use
  Truth Blue or a state colour — only when it encodes meaning.

## 6. Spacing scale

4px base. Steps `1,2,3,4,6,8,10,12,16` (× 0.25rem). Page container
`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8`. Card padding `p-5 sm:p-6`. Section rhythm
`space-y-6 sm:space-y-8`.

## 7. Radius

`--radius: 0.5rem` (`lg`, cards/modals); `md = −2px` (buttons/inputs); `sm = −4px` (chips);
`xl = 0.75rem` (feature panels). No pill buttons except tags/badges; machined, not blobby.

## 8. Elevation / shadow (refined)

Depth = **surface step + restrained material edge**, not glossy shine.

| Level | Treatment | Use |
|-------|-----------|-----|
| 0 | `--lm-graphite` | Page canvas |
| 1 | `--lm-gunmetal` + 1px `--border`; refined 2-stop gradient | Cards, panels (no top shine) |
| 2 | `--lm-charcoal` + `--lm-edge-highlight` (0.07) + soft shadow | Popover, dropdown, sheet |
| 3 | raised metal + `--lm-panel-shadow` + scrim | Modal/dialog (floating) |

No glowing borders, no neon, no mirror-shine. Edge highlight is the *only* permitted metallic
catch-light, and only on genuinely raised surfaces.

## 9. Icon system

- **Lucide only** (`lucide-react`). Single system (Foundation N7).
- Sizes `16/20/24`, stroke `1.75–2`. Default `--lm-muted`; **active/insight `--truth-blue-bright`**.
- **Remove FontAwesome** (the `index.css` CDN `@import` and all `fas fa-*` — measured 19 occ / 5
  files: `index.css`, `home.tsx`, `top-customers-table.tsx`, `metric-card.tsx`,
  `analytics-dashboard.tsx`). Icon-only controls require `aria-label`.

## 10. Chart tokens

Truth-forward, single-hue-first, on metal surfaces; never rainbow.

| Token | Value | Use |
|-------|-------|-----|
| `--chart-1` | `var(--truth-blue-bright)` | Primary series (the truth) |
| `--chart-2` | `hsl(200 60% 52%)` | Secondary |
| `--chart-3` | `hsl(190 35% 45%)` | Tertiary |
| `--chart-4` / `--chart-5` | `hsl(216 12% 55%)` / `hsl(216 10% 38%)` | Neutral metal series |
| Heatmap ramp | `--lm-gunmetal` → `--truth-blue-bright` | Low → high magnitude |
| Good / bad | `--success` / `--danger` | Only where the value *is* a state |

Gridlines `--lm-brushed` (low opacity); labels `--lm-muted`; always non-colour labels/legends.

## 11. Button styles

44px min height; radius `md`; focus ring `2px --truth-blue-bright`.
**Retire the brushed-metal mirror fill (`lm-btn-metal` shine); promote Truth Blue to primary.**

| Variant | Surface | Text | Use |
|---------|---------|------|-----|
| **Primary** | `--truth-blue` (hover `--truth-blue-strong`) | `--truth-blue-foreground` | The route's main action / Next Move |
| **Secondary** | refined matte metal (`--lm-charcoal` + 1px `--border`, no shine) | `--lm-warm-white` | Supporting action (the refined `lm-btn-outline`) |
| Ghost | transparent (hover `--lm-charcoal`) | `--lm-warm-white` | Tertiary / icon buttons |
| Destructive | `--danger` | white | Delete/void/refund (with confirm) |

One primary per view — the action the truth demands, in Truth Blue.

## 12. Card styles

- Forged-metal surface: `--lm-gunmetal` + refined 2-stop gradient + 1px `--border`, radius `lg`.
  **No top mirror-shine, no edge-light on flat cards.** Material depth stays subtle.
- Selected/active card: `--truth-blue-subtle` fill + `--truth-blue` left/edge accent.
- **TruthCard** (KPI): large `tabular-nums` value (`--lm-warm-white`), muted label, Lucide icon, and
  one meaningful delta (Truth Blue or state colour). Replaces the light-theme `metric-card`.

## 13. Table styles

- Metal surface; header `--lm-muted` `text-xs uppercase tracking-wide`, bottom `--border`.
- Rows on `--lm-gunmetal`; hover `--lm-charcoal`; **selected row `--truth-blue-subtle`**.
- Numerics right-aligned `tabular-nums`. **Mobile:** stack to cards (no horizontal scroll).

## 14. Modal styles

- Raised metal surface (`--lm-charcoal`), radius `lg`, `--lm-panel-shadow`, scrim
  `hsl(0 0% 0% / 0.6)`. Title → body → actions; primary right (Truth Blue), destructive `--danger`.
  Focus-trapped; `Esc` closes.

## 15. Loading states

- **Skeleton** for list/table/card initial load on `--lm-charcoal`; honours
  `prefers-reduced-motion` (`motion-reduce:animate-none`). Per [`docs/UI_PATTERNS.md`](../UI_PATTERNS.md).
- **Spinner** (`Loader2`) for inline actions only; never a whole-page/list spinner. Never block
  selling on a spinner.

## 16. Accessibility

- **WCAG 2.1 AA** on operator-critical surfaces ([`docs/ACCESSIBILITY.md`](../ACCESSIBILITY.md)).
- Text ≥ 4.5:1 (≥ 3:1 large/UI) — §3 pairings meet this; Truth Blue on graphite ≈7:1.
- Focus visible: `2px --truth-blue-bright`. Targets ≥ 44px. Selection/state never by colour alone.
  Reduced motion respected. Verify with `npm run test:a11y` after token changes.

## 17. Theme rule

**Arcarna is a single dark, forged-metal theme.** No separate light product theme. The legacy light
`:root` / `.dark` shadcn blocks in `index.css` are deprecated for product surfaces (they only ever
applied outside the `.liquid-metal` scope). A print style for evidence/receipts is a separate,
explicitly-scoped concern.

## 18. Refinement & migration plan (refine `liquid-metal.css`, don't remove)

1. **Refine, in place:** in `client/src/styles/tokens/liquid-metal.css`, dial down decorative shine
   per §3.5 — 2-stop low-contrast surface gradient, edge-highlight only on raised surfaces, drop the
   inset top-light, soften panel shadow.
2. **Add Truth Blue tokens** to the `.liquid-metal` scope (and `.lm-auth-shell`): the §3.3 scale.
3. **Remap semantic tokens inside the scope:** `--primary → --truth-blue`,
   `--primary-foreground → --truth-blue-foreground`, `--ring → --truth-blue-bright`,
   `--accent → --truth-blue-subtle`, `--accent-foreground → --truth-blue-bright`. Keep
   `--background/--card/--popover/--secondary/--muted` on the metal tones. Map `--destructive →
   crimson` (already), and add `--success/--warning` aliases to emerald/amber.
4. **Nav active state → Truth Blue:** `.lm-nav-link-active` uses a `--truth-blue-subtle` tint +
   `--truth-blue` icon/left-accent instead of the metal-gradient highlight.
5. **Buttons:** primary = Truth Blue; refine `lm-btn-outline` to matte secondary; **retire the
   `lm-btn-metal` mirror fill** (replace usages with primary Truth Blue or matte secondary).
6. **Tailwind:** add a `truth.*` colour group; keep the `metal.*` group (retained material);
   map `--success/--warning/--danger`.
7. **Remove FontAwesome** `@import` + usages → Lucide (§9).
8. Update the `liquid-metal.css` header comment `MIDNIGHT_UX_REDESIGN_BRIEF.md` →
   `ARCARNA_UX_REDESIGN_BRIEF.md` (residue).

Ship behind the per-org flag where a surface changes visibly mid-flight (Architectural Principle 11).

## 19. Decorative-effect reduction & hardcoded-colour checklist

| Location | Issue | Action |
|----------|-------|--------|
| `liquid-metal.css` `--lm-surface-gradient`, `--lm-inner-shadow`, `--lm-edge-highlight` | decorative shine/gloss | refine per §3.5 (retain material) |
| `liquid-metal.css` `.lm-btn-metal` | brushed-metal mirror fill | retire → Truth Blue primary |
| `liquid-metal.css` `.lm-nav-link-active` | metal-gradient highlight | Truth Blue selection treatment |
| `client/src/components/metric-card.tsx` | **light** gradient `to-[hsl(210,40%,98%)]` (L19), dynamic `bg-${iconColor}` (L22), decorative `text-accent` pill (L26), `fas fa-*` | rebuild as `TruthCard` on metal + Truth Blue + Lucide |
| `client/src/pages/home.tsx`, `top-customers-table.tsx`, `analytics-dashboard.tsx` | `fas fa-*` icons | Lucide |
| `client/src/index.css` | FontAwesome `@import`; legacy light/dark `:root` blocks | remove import; deprecate light product tokens |
| `client/src/components/EmptyState.tsx` | inline `hsl(...)` ring/border literals | use `--border`/metal tokens |

Audit command (illustrative):
```bash
rg -n "fas fa-|lm-btn-metal|to-\[hsl\(210, ?40%" client/src && echo "REFINEMENT WORK FOUND"
```

## 20. Acceptance criteria

- [ ] Liquid Metal **retained and refined** — forged material reads as metal, not flat; decorative
      shine/gloss/excess gradient removed (§3.5, §8).
- [ ] **Truth Blue** is the semantic accent for insight, action, selection, understanding (§4).
- [ ] `lm-btn-metal` mirror fill retired; primary actions are Truth Blue; active nav uses Truth Blue.
- [ ] **Colour/shine encode meaning only**; state & selection never by colour alone.
- [ ] **Lucide** only; FontAwesome removed (19/5 → 0).
- [ ] Themed colour from tokens — no hardcoded hex/hsl on components; light `metric-card` rebuilt.
- [ ] Single dark forged-metal theme; legacy light product tokens deprecated.
- [ ] Focus ring `--truth-blue-bright`; targets ≥ 44px; `npm run test:a11y` green.
- [ ] Charts single-hue-first on metal, with non-colour labels.
