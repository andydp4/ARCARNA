# ARCARNA™ Design System Specification

> **Agent 4 — Design System Architect.** Subordinate to
> [`ARCARNA_FOUNDATION_SPECIFICATION.md`](./ARCARNA_FOUNDATION_SPECIFICATION.md). **Owns** tokens,
> colour, type, spacing, elevation, motion, and the colour-as-meaning law.
>
> **Core principle:** *Darkness is the canvas. Truth is the light. Understanding is the destination.*
>
> **Direction (binding):** **Truth Blue** is the primary accent. **Remove decorative Liquid
> Metal / chrome / brushed-metal gradient effects.** Use **Inter** for product UI.
>
> **Current code:** the implemented theme is "Liquid Metal" (`liquid-metal.css`, `lm-*` tokens,
> brushed-metal gradients, FontAwesome). This spec defines the **target**; §18–§19 give the
> migration and the Compliance Report records the gap.

---

## 1. Design philosophy

The product is a **dark, calm canvas**. Meaning is carried by **light** — a single truth-bearing
accent (**Truth Blue**) and a small set of state colours. Nothing on screen is decorative: every
surface is flat and quiet so the *truth* is the brightest, clearest thing in view.

- Darkness = the canvas (neutral, low-noise surfaces).
- Truth Blue = the light (primary actions, active state, revealed truths, data highlights).
- State colours = success / warning / danger only.
- **Removed:** brushed-metal gradients, chrome edge-highlights, inner-shadow "machined" treatments,
  metal button surfaces. These were decorative; they go.

## 2. Token architecture

Three layers, one direction (single dark theme):

1. **Primitive tokens** — raw values: `--canvas`, `--surface*`, `--truth-blue*`, `--success`, etc.
   Defined once in `client/src/styles/tokens/arcarna.css` (new) at `:root`.
2. **Semantic / shadcn tokens** — `--background`, `--foreground`, `--card`, `--primary`, `--ring`…
   mapped to primitives so existing shadcn components inherit the new system.
3. **Tailwind utilities** — `tailwind.config.ts` exposes primitives as colour groups
   (`truth.*`, `surface.*`, `success|warning|danger`) and maps semantic tokens.

No component hardcodes colour; it consumes tokens via Tailwind classes or CSS vars.

## 3. Colour tokens

### 3.1 Canvas & surfaces (the dark)
| Token | Value | Role |
|-------|-------|------|
| `--canvas` | `hsl(222 18% 7%)` | App background |
| `--surface` | `hsl(222 16% 10%)` | Card / panel |
| `--surface-2` | `hsl(221 14% 13%)` | Popover, modal, raised |
| `--surface-3` | `hsl(220 13% 17%)` | Inputs, hover, secondary button |
| `--border` | `hsl(0 0% 100% / 0.08)` | Hairline borders |
| `--border-strong` | `hsl(0 0% 100% / 0.14)` | Emphasised borders, focus halo edge |

### 3.2 Text
| Token | Value | Role |
|-------|-------|------|
| `--text` | `hsl(210 20% 96%)` | Primary text |
| `--text-muted` | `hsl(215 12% 62%)` | Secondary text |
| `--text-subtle` | `hsl(216 10% 45%)` | Tertiary / placeholder |

### 3.3 Truth Blue — the primary accent (the light)
| Token | Value | Role | Contrast |
|-------|-------|------|----------|
| `--truth-blue-bright` | `hsl(208 96% 64%)` | Truth/data highlight, links, active text, chart-1 — on dark canvas | ≈7.4:1 on `--canvas` |
| `--truth-blue` | `hsl(213 90% 46%)` | Primary action / button base | ≈4.9:1 with white text |
| `--truth-blue-strong` | `hsl(214 90% 39%)` | Hover / pressed |
| `--truth-blue-subtle` | `hsl(212 90% 60% / 0.14)` | Selected rows, tinted fills, focus halo |
| `--truth-blue-foreground` | `hsl(210 40% 98%)` | Text/icon on Truth Blue |

### 3.4 State colours (semantic — meaning only)
| Token | Value | State |
|-------|-------|-------|
| `--success` | `hsl(158 64% 45%)` | Positive / balanced / in stock |
| `--warning` | `hsl(38 92% 52%)` | Attention / low stock / due soon |
| `--danger` | `hsl(2 78% 56%)` | Destructive / overdue / out of stock |
| `--info` | `var(--truth-blue-bright)` | Neutral informational |

## 4. Semantic colour rules (binding)

1. **Truth Blue carries truth and action.** Primary buttons, active nav, focus, links, the
   highlighted truth/number, and the primary data series. Nothing else is blue.
2. **State colours carry state only.** Never use success/warning/danger for emphasis or theming.
3. **No decorative colour** (Foundation N6). If a colour is on screen, a reader can name the
   state or truth it encodes.
4. **Never colour alone.** State is always reinforced by text or icon (accessibility).
5. **Neutral by default.** Most of the UI is canvas/surface/text; colour is the exception, used to
   reveal the one thing that matters.

## 5. Typography rules

- **Family:** `Inter` for all product UI (`--font-sans: 'Inter', system-ui, sans-serif`). Mono
  `Menlo` for codes/IDs only. No serif in product chrome.
- **Weights:** 400 body, 500 labels, 600 headings/emphasis, 700 for hero metrics.
- **Scale:** H1 `text-2xl/3xl` 600; H2 `text-xl/2xl` 600; body `text-sm/base` 400 `leading-relaxed`;
  metric `text-3xl` 700; eyebrow `text-xs uppercase tracking-wider text-muted`.
- **Numbers:** **always `tabular-nums`** for money/metrics/tables.
- **Truth emphasis:** the headline truth uses `--text` at large weight; its supporting accent (delta,
  trend) may use Truth Blue or a state colour — only when it encodes meaning.

## 6. Spacing scale

4px base (Tailwind default). Approved steps: `1,2,3,4,6,8,10,12,16` (× 0.25rem).

- Page container: `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8`.
- Card padding: `p-5 sm:p-6`. Section rhythm: `space-y-6 sm:space-y-8`.
- Header block: title → subtitle → divider; `mb-6`–`mb-8`.

## 7. Radius

| Token | Value | Use |
|-------|-------|-----|
| `--radius` | `0.5rem` | Base (`lg`) — cards, modals |
| `md` | `calc(--radius − 2px)` | Buttons, inputs |
| `sm` | `calc(--radius − 4px)` | Chips, small controls |
| `xl` | `0.75rem` | Hero/feature panels |

No fully-rounded "blobs"; no pill buttons except tags/badges.

## 8. Elevation / shadow

Depth comes from **surface steps + 1px borders**, not heavy shadows (chrome inner-shadows removed).

| Level | Treatment | Use |
|-------|-----------|-----|
| 0 | `--canvas` | Page |
| 1 | `--surface` + `--border` | Cards, panels |
| 2 | `--surface-2` + `--border-strong` + `--shadow-md` | Popover, dropdown, sheet |
| 3 | `--surface-2` + `--shadow-lg` + scrim | Modal/dialog |

Shadows: `--shadow-md: 0 8px 24px hsl(0 0% 0% / 0.45)`; `--shadow-lg: 0 16px 48px hsl(0 0% 0% / 0.55)`.
No glowing borders, no neon, no metal sheen.

## 9. Icon system

- **Lucide only** (`lucide-react`). Single system (Foundation N7).
- Sizes `16 / 20 / 24`; stroke `1.75–2`. Default icon colour `--text-muted`; active `--truth-blue-bright`.
- **Remove FontAwesome entirely** — the `index.css` CDN import and all `fas fa-*` usage
  (e.g. `home.tsx`, `metric-card.tsx`) are non-compliant duplicates (§19).
- Icon-only controls require `aria-label`.

## 10. Chart tokens

Truth-forward, **single-hue-first**, never rainbow.

| Token | Value | Use |
|-------|-------|-----|
| `--chart-1` | `var(--truth-blue-bright)` | Primary series (the truth) |
| `--chart-2` | `hsl(200 60% 52%)` | Secondary series |
| `--chart-3` | `hsl(190 35% 45%)` | Tertiary |
| `--chart-4` | `hsl(216 12% 55%)` | Neutral series |
| `--chart-5` | `hsl(216 10% 38%)` | Neutral low |
| Heatmap ramp | `--surface` → `--truth-blue-bright` | Low → high magnitude |
| Good / bad in charts | `--success` / `--danger` | Only where the value *is* a state |

Gridlines `--border`; axis labels `--text-muted`; always provide non-colour labels/legends.

## 11. Button styles

44px min height; radius `md`; focus ring `2px --truth-blue-bright`. **Remove `lm-btn-metal`/`lm-btn-outline` metal gradients.**

| Variant | Surface | Text | Use |
|---------|---------|------|-----|
| Primary | `--truth-blue` (hover `--truth-blue-strong`) | `--truth-blue-foreground` | The route's main action / Next Move |
| Secondary | `--surface-3` + `--border` | `--text` | Supporting action |
| Ghost | transparent (hover `--surface-3`) | `--text` | Tertiary / icon buttons |
| Destructive | `--danger` | white | Delete/void/refund (with confirm) |

One primary per view (the action the truth demands).

## 12. Card styles

- `--surface` + `1px --border` + radius `lg`; flat. No gradient, no inner shadow, no edge highlight.
- Optional hover: border → `--border-strong` (no lift/scale on data cards).
- Truth/KPI card: large `tabular-nums` value (`--text`), label (`--text-muted`), and a single
  meaningful delta (Truth Blue or state colour). Replaces `lm-card`/`pos-summary-card`/`metric-card`.

## 13. Table styles

- Dense, scannable. Header: `--text-muted`, `text-xs uppercase tracking-wide`, bottom `--border`.
- Rows: `--surface`; hover `--surface-2`; **selected** `--truth-blue-subtle`.
- Numerics right-aligned, `tabular-nums`. Row min-height comfortable for touch.
- **Mobile:** stack rows into cards (no horizontal scroll) — Foundation UX mobile-first.

## 14. Modal styles

- `--surface-2`, radius `lg`, `--shadow-lg`, backdrop scrim `hsl(0 0% 0% / 0.6)`.
- Title (decision) → body (consequence) → actions; primary right.
- Destructive confirm uses `--danger`; everything else Truth Blue primary. Trap focus; `Esc` closes.

## 15. Loading states

- **Skeleton** for list/table/card initial load (`--surface-2` shimmer); honours
  `prefers-reduced-motion` (`motion-reduce:animate-none`). Per [`docs/UI_PATTERNS.md`](../UI_PATTERNS.md).
- **Spinner** (Lucide `Loader2`) for inline actions only (button pending, dialog refetch) — never a
  whole-page/list spinner.
- Optimistic where safe; never block selling on a spinner.

## 16. Accessibility

- **WCAG 2.1 AA** on operator-critical surfaces (Create Order, Customers, Products, Open Orders,
  Settings). Source: [`docs/ACCESSIBILITY.md`](../ACCESSIBILITY.md).
- Text contrast ≥ 4.5:1 (≥ 3:1 large/UI). Token pairings in §3 meet this.
- Focus visible everywhere: `2px --truth-blue-bright` ring.
- Touch targets ≥ 44px. State never by colour alone. Reduced-motion respected.
- Verify with `npm run test:a11y` after any token change.

## 17. Dark-mode rule

**Arcarna is a single dark theme — darkness is the canvas.** There is no separate light product
theme. The legacy light `:root` and `.dark` shadcn blocks in `index.css` are **deprecated for
product surfaces**; the new `:root` carries the dark tokens directly. (If a light context is ever
needed — e.g. printed evidence/receipts — it is a separate, explicitly-scoped print style.)

## 18. Tailwind / CSS variable migration plan

1. **Add** `client/src/styles/tokens/arcarna.css` with §3 primitives + semantic mapping at `:root`
   (single dark theme). Import it in `index.css` **above** the legacy token import.
2. **Map semantic → primitive:** `--background→--canvas`, `--foreground→--text`, `--card→--surface`,
   `--popover→--surface-2`, `--primary→--truth-blue`, `--primary-foreground→--truth-blue-foreground`,
   `--secondary→--surface-3`, `--muted→--surface-2`, `--muted-foreground→--text-muted`,
   `--accent→--truth-blue-subtle`, `--accent-foreground→--truth-blue-bright`,
   `--destructive→--danger`, `--border→--border`, `--input→--surface-3`, `--ring→--truth-blue-bright`.
3. **Alias the legacy tokens** during transition: in `liquid-metal.css`, point `--lm-*` at the new
   tokens (e.g. `--lm-graphite: var(--canvas)`, `--lm-stainless: var(--truth-blue-bright)`) and
   neutralise the brushed-metal **gradients/shadows** to flat surfaces. This keeps existing
   `lm-*`/`pos-*` classes rendering correctly while components migrate.
4. **Update `tailwind.config.ts`:** add `truth`, `surface`, `success/warning/danger` colour groups;
   keep shadcn mappings; **deprecate the `metal.*` group** (alias to new tokens, then remove).
5. **Remove the FontAwesome `@import`** from `index.css`; migrate icons to Lucide.
6. **Remove `liquid-metal.css`** once all `lm-*`/`pos-*` consumers are migrated to the new tokens.

Ship behind the existing per-org flag mechanism where a surface changes visibly mid-flight
(Architectural Principle 11).

## 19. Hardcoded colour replacement checklist

| Location | Issue | Replace with |
|----------|-------|--------------|
| `client/src/components/metric-card.tsx` | `from-card to-[hsl(210,40%,98%)]` light gradient; `text-accent bg-accent/10` decorative; `fas fa-*` | `--surface` card + Lucide + Truth Blue/state delta |
| `client/src/pages/home.tsx` | `fas fa-*` quick-action icons | Lucide icons |
| `client/src/index.css` | FontAwesome CDN `@import`; legacy light/dark `:root` blocks | remove import; dark tokens at `:root` |
| `client/src/styles/tokens/liquid-metal.css` | brushed-metal gradients, edge highlights, inner shadows, `lm-btn-metal` | flat `--surface`/`--border`; Truth Blue buttons |
| `client/src/components/EmptyState.tsx` | inline `hsl(...)` ring/border literals | `--border`/`--surface-2` tokens |
| Any `bg-${iconColor}` / dynamic colour classes | unsafe + decorative | token-based state classes |

Audit command (illustrative):
```bash
rg -n "fas fa-|font-awesome|hsl\(210, ?40%|lm-btn-metal" client/src && echo "DESIGN DEBT FOUND"
```

## 20. Acceptance criteria

- [ ] Primary accent is **Truth Blue**; no decorative Liquid Metal/chrome remains on a redesigned surface.
- [ ] Product UI uses **Inter**; numbers use `tabular-nums`.
- [ ] **Colour encodes meaning only**; state never by colour alone.
- [ ] **Lucide** is the only icon system; FontAwesome removed.
- [ ] All themed colour comes from tokens — **no hardcoded hex/hsl** on components (§19 clear).
- [ ] Single **dark** theme; legacy light product tokens deprecated.
- [ ] Focus ring visible (`--truth-blue-bright`); targets ≥ 44px; `npm run test:a11y` green.
- [ ] Charts single-hue-first, with non-colour labels.
