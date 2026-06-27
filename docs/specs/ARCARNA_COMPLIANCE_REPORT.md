# ARCARNA™ Compliance Report

> **Agent 5 — QA Architect.** Audits the specification set for **contradiction, duplication,
> missing implementation detail, and brand compliance**, and registers the gap between the specs
> (target) and the current codebase. **Per the orchestration rule, implementation must not begin
> until this report passes.**
>
> **Verdict:** **PASS.** The five specs are internally consistent and implementation-ready. Both
> open items are resolved (visual direction: refine Liquid Metal + Truth Blue; orphan routes: keep
> out of primary nav for now — §2/§7). The set is fully signed off; implementation may proceed.

---

## 1. Scope & method

Audited documents (all in `docs/specs/`):

1. `ARCARNA_FOUNDATION_SPECIFICATION.md`
2. `ARCARNA_ROUTE_EXPERIENCE_SPECIFICATION.md`
3. `ARCARNA_COMPONENT_SPECIFICATION.md`
4. `ARCARNA_LANGUAGE_SPECIFICATION.md`
5. `ARCARNA_DESIGN_SYSTEM_SPECIFICATION.md`

Method: cross-spec consistency check (terminology, direction, framework), duplication ledger
reconciliation, non-negotiable verification (Foundation §14/§15), and a codebase gap pass over
`client/src/**`, `shared/brand.ts`, `docs/`, anchored to the source files each spec cites.
**No code was changed** (documentation-only task).

---

## 2. Contradiction audit (cross-spec)

| Check | Result |
|-------|--------|
| Single brand truth / tagline across specs | ✅ "Reveal Your Truth™", founder £300 moment consistent |
| Terminology consistent (Control Centre, Truths, Evidence, Signals, Next Moves) | ✅ Foundation §10 = Language §1/§3 = Component/Route usage |
| Framework consistent (Question→Truth→Action; Reveal→Explain→Guide) | ✅ Foundation §11–§12 referenced identically downstream |
| Design direction consistent (refined Liquid Metal + Truth Blue accent, Inter) | ✅ Foundation §6 = Design System §1/§3 = Component surfaces |
| Route grouping consistent (6 groups) | ✅ Foundation/Language/Route/Component agree |
| Authority/reading order unambiguous | ✅ Foundation §0 defines precedence; no circular ownership |

**Resolved (owner decision).** An earlier draft of the Design System brief read as *replace* Liquid
Metal with a flat Truth-Blue theme, which would have contradicted
`docs/ux-concepts/ARCARNA_UX_REDESIGN_BRIEF.md` ("Liquid Metal Industrial — Approved design
direction") and the orchestration line "Do not redesign the product." The owner has resolved this:
**refine Liquid Metal — do not replace it.** Retain the forged-industrial material language; remove
only decorative chrome / excess gradients / shine; introduce **Truth Blue** as the *semantic accent*
for insight, action, selection, and understanding (material = craft, blue = revelation). This
**reconciles** with the existing Liquid Metal brief rather than superseding it, and scopes the change
to the *visual system + language* (not product capability/IA). **No contradiction remains.**

---

## 3. Duplication audit (Foundation §15.1 / N7)

### 3.1 Terminology — ✅ resolved in spec
One concept = one term; Language §1/§3 is the single glossary. No competing synonyms across specs.

### 3.2 Components — ⚠ duplicates exist in code; ledger defined
| Concept | Canonical (keep) | Retire / migrate | Status |
|---------|------------------|------------------|--------|
| Page header | `PageHeader` (canonical contract, Component §3) | `AppPageHeader` ↔ `PageHeader` (two exist) | **Open in code** |
| Empty state | `EmptyState` | `EmptyStatePanel` (CTA cases) | **Open in code** |
| KPI / Truth card | `TruthCard`/`DailyKpiCard` | `MetricCard` | **Open in code** |
| Icon system | `lucide-react` | FontAwesome (`fas fa-*`) | **Open in code** |

### 3.3 Routes — ⚠ render-aliases
`/reports` and `/analytics` both render `Insights` (`App.tsx`) — two names, one page. Route §9
mandates converting to **redirects** to `/insights`.

---

## 4. Brand compliance audit

| Check | Result | Evidence |
|-------|--------|----------|
| Brand constants centralised | ✅ | `shared/brand.ts` (`BRAND_NAME`, `BRAND_PRODUCT_NAME`) used by `Layout` |
| Logo law (no redrawn mark) | ✅ in spec | `BrandLogo` variants; official assets |
| Midnight residue (user-facing chrome) | ✅ **measured 0** | `rg "Midnight EPOS" client/ portal/ server/templates` → 0 hits. The user-facing rebrand is done. `analytics/rfm.tsx` `/midnight/api` is **already fixed** (0 hits) — corrects an earlier draft claim. |
| Midnight residue (non-chrome) | ⚠ low | `README.md` line 1 title "Midnight EPOS"; `liquid-metal.css` line 4 comment references `MIDNIGHT_UX_REDESIGN_BRIEF.md` (renamed). Docs/archive intentionally left historical per rebrand plan. |
| Forbidden language (SaaS/AI hype) | ✅ **measured 0** | `rg` over `client/src` for the §2 list → 0 hits |
| Colour = meaning only (N6) | ⚠ | `metric-card.tsx` light gradient `to-[hsl(210,40%,98%)]` (line 19), dynamic `bg-${iconColor}` (line 22), decorative `text-accent bg-accent/10` pill (line 26); metal gradients are decorative by construction |
| Single icon system (N7) | ⚠ | FontAwesome: **19 occurrences across 5 files** — `index.css` (CDN `@import`), `home.tsx`, `top-customers-table.tsx`, `metric-card.tsx`, `analytics-dashboard.tsx` |
| Approved nav terms | ⚠ | `nav-items.ts` still "Dashboard", "Business Insights", "RFM Segments", "Hour of day", "Channels", "Stock turn", "Scheduled reports", "Gift cards" (8 labels) |

---

## 5. Missing implementation detail audit

| Area | Status |
|------|--------|
| Truth Blue defined with concrete values + contrast | ✅ Design System §3.3 (AA-checked) |
| Token migration plan (Tailwind + CSS vars + alias period) | ✅ Design System §18 |
| Hardcoded-colour replacement checklist | ✅ Design System §19 |
| Per-route Question/Truth/Action + components + priority | ✅ Route §3–§8 |
| Component contracts + maturity model + dedup ledger | ✅ Component §3–§21 |
| Microcopy patterns (empty/error/toast/modal/voice) | ✅ Language §7–§11 |
| Enforcement/grep gates | ✅ Language §18, Design System §19, Component §21 |
| **Open decisions (need owner input)** | ⚠ orphan-route placement (Route §10); direction sign-off (§7) |

---

## 6. Non-negotiables verification (Foundation §14/§15)

| # | Rule | In-spec | In-code (current) |
|---|------|---------|-------------------|
| N1 | Don't redesign product scope | ✅ specs touch experience/visual/language only | ✅ no route/capability added |
| N2 | No new brand strategy | ✅ traces to founder story | n/a |
| N3 | No generic SaaS language | ✅ banned list + gate | ⚠ enforce in copy sweep |
| N4 | No AI hype | ✅ assistant = rule-based | ⚠ ensure "Smart Stock" copy compliant |
| N5 | No Midnight language | ✅ banned | ✅ chrome clean (measured 0); ⚠ README title + css comment only (§4) |
| N6 | No decorative colour | ✅ colour=meaning | ⚠ `metric-card`, metal gradients |
| N7 | No duplicate term/component | ✅ ledgers | ⚠ headers/empty/KPI/icons (§3) |

---

## 7. Gate decision

**Documentation deliverable: COMPLETE and CONSISTENT.** All six required outputs exist; the five
specs pass contradiction/duplication/missing-detail checks at the document level.

**Resolved — both open items closed:**

1. ✅ **Direction (§2).** Owner decision: **refine Liquid Metal + Truth Blue accent** (do not
   replace). Specs updated; no contradiction remains.
2. ✅ **Orphan routes (Route §10).** Owner decision: **do not add to primary nav now**; keep
   reachable via existing deep links / admin-developer surfaces. Future gated placement deferred
   (Purchase Drafts→Stock, permission/feature gated; Audit Log→Administer, admin only; System
   Activity & Rules→Administer, developer/admin only).

**No items remain. The specification set is fully signed off; implementation may proceed against
the specs and the §8 backlog (R1–R13).**

---

## 8. Remediation backlog (code — for after sign-off)

| ID | Item | Spec | Severity |
|----|------|------|----------|
| ✅ R1 | Truth Blue token layer (`arcarna.css`) added; `--primary/--accent/--ring` → Truth Blue; metal tokens retained | Design §18 | **Done (Phase 1)** |
| ✅ R2 | FontAwesome removed (CDN @import + all `fas/fab` usages → Lucide); `metric-card.tsx` retired | Design §9/§19 | **Done (Phase 5a)** |
| ✅ R3 | `MetricCard` retired; `analytics-dashboard` migrated to canonical `InsightCard` (tokens, state-only colour) | Component §5 | **Done (Phase 5a)** |
| ✅ R4 | Page headers converged on canonical `PageHeader`; `AppPageHeader` removed | Component §3 | **Done (Phase 2 + 5b)** |
| ✅ R5 | Renamed `nav-items.ts` labels + page titles to approved terms (Control Centre, Truths, …) | Route §14 / Language §3 | **Done (Phase 3)** |
| ✅ R6 | **Refine** Liquid Metal surfaces (Phase 1 tokens) + component sweep: FA→Lucide, hardcoded colours → tokens (`metal-*`, `success`/`danger`) | Design §3.5/§8/§11–§13 | **Done (Phase 1 + 5)** |
| ✅ R7 | `/reports` & `/analytics` now redirect to `/insights` | Route §9 | **Done (Phase 7 prep)** |
| ~~R8~~ | ~~Fix `analytics/rfm.tsx` `/midnight/api`~~ — **already resolved** (measured 0 hits) | Route §6 / §4 | Done |
| ✅ R9 | Page `question` subtitle on all operational + admin content routes (31 pages); auth/wizard routes excepted by design | Route §14 / Language §5 | **Done (Phase 2/5b/7)** |
| ✅ R10 | Adopt `EmptyState`; `EmptyStatePanel` retired (SmartStockTab migrated, +CTA) | Component §10 | **Done (Phase 5c)** |
| R11 | Copy sweep: forbidden words + Midnight residue (README/docs/comments) | Language §18 | Medium |
| R12 | a11y verification on P0 routes after token change (`npm run test:a11y`) | Design §16 | Medium |
| R13 | Orphan routes: **keep out of primary nav now** (decided); future gated placement per §10 (Purchase Drafts→Stock; Audit Log/System Activity/Rules→Administer) | Route §10 | Deferred |

---

## 9. Measured findings (verified against the codebase)

Ran the spec greps against the working tree (read-only; no code changed). Numbers below are the
evidence behind §3–§6.

| Audit | Command (essence) | Result |
|-------|-------------------|--------|
| FontAwesome usage | `rg "fas fa-\|font-awesome" client/src` | **19** occurrences, **5** files: `index.css`, `home.tsx`, `top-customers-table.tsx`, `metric-card.tsx`, `analytics-dashboard.tsx` |
| Midnight in user-facing chrome | `rg "Midnight EPOS" client/ portal/ server/templates` | **0** ✅ |
| Hardcoded `/midnight/api` | `rg "/midnight/api" client/src` | **0** ✅ (already fixed) |
| Midnight residue (non-chrome) | `rg "Midnight EPOS\|MIDNIGHT_UX"` | `README.md:1`, `liquid-metal.css:4` (low) |
| Forbidden SaaS/AI words | `rg -i "AI-powered\|streamline\|seamless\|…" client/src` | **0** ✅ |
| `metric-card.tsx` decorative/light | inspect | light gradient L19, dynamic `bg-${iconColor}` L22, decorative pill L26 — confirmed |
| `/reports` & `/analytics` render-alias | `rg 'path="/reports"\|"/analytics"' App.tsx` | both `component={Insights}` (L91–92) — confirmed, need redirects |
| Duplicate components | `ls` | `PageHeader` + `app-page-header`; `EmptyState` + `empty-state-panel`; `metric-card` + `DailyKpiCard` — all present |
| Nav labels to rename | `rg "label: '…'" nav-items.ts` | 8: Dashboard, Gift cards, Business Insights, RFM Segments, Hour of day, Channels, Stock turn, Scheduled reports |

**Migration scale (sizing for R1/R6):** `lm-*` classes ≈ **207** usages · `pos-*` surfaces ≈ **44** ·
`metal-*` Tailwind colours ≈ **122**. This confirms the Design System §18 **alias-then-remove**
strategy (don't hard-cut) is the right approach.

**Net:** the user-facing rebrand is cleaner than the first draft assumed (no Midnight in chrome, no
forbidden words). The real, sized debt is the **visual system** (Truth Blue migration), **icon
system** (FontAwesome → Lucide), and **component duplication** — all in §8.

---

## 10. Sign-off

| Role | Output | Status |
|------|--------|--------|
| Foundation Architect | `ARCARNA_FOUNDATION_SPECIFICATION.md` | ✅ |
| Route Architect | `ARCARNA_ROUTE_EXPERIENCE_SPECIFICATION.md` | ✅ |
| Component Architect | `ARCARNA_COMPONENT_SPECIFICATION.md` | ✅ |
| Language Architect | `ARCARNA_LANGUAGE_SPECIFICATION.md` | ✅ |
| Design System Architect | `ARCARNA_DESIGN_SYSTEM_SPECIFICATION.md` | ✅ |
| QA Architect | `ARCARNA_COMPLIANCE_REPORT.md` | ✅ (conditional — §7) |

**Owner action required:** confirm §7.1 (direction) and §7.2 (orphan routes) to unblock implementation.
*(Both confirmed — see §7. Implementation delivered in Phases 1–6; final audit in §11.)*

---

## 11. Phase 7 — Final implementation audit

Implementation phases 1–6 are complete. This audit re-runs the spec gates against the working tree.
**Every machine-checkable gate passes.** `tsc --noEmit` and `vite build` are green.

### 11.1 Gate results (measured)

| Gate | Target | Result |
|------|--------|--------|
| FontAwesome usages (`fas/fab fa-`, CDN import) | 0 | **0** ✅ |
| Double-wrapped `hsl(var(--token))` | 0 | **0** ✅ |
| Hardcoded light-theme chart colours | 0 | **0** ✅ |
| Forbidden SaaS/AI words in `client/src` | 0 | **0** ✅ |
| "Midnight" in user-facing chrome | 0 | **0** ✅ |
| Legacy nav labels (Dashboard / Business Insights / Notifications) | 0 | **0** ✅ (renamed to Control Centre / Truths / Signals) |
| Duplicate components (`metric-card`, `app-page-header`, `empty-state-panel`, `business-truth-card`) | removed | **all removed** ✅ |
| Canonical components present (`insight-card`, `standard-dialog`, `chart-card`, `PageHeader`, `SettingsSection`, `DataTableState`) | present | **all present** ✅ |
| `tsc` / `vite build` | green | **green** ✅ |

### 11.2 Coverage by phase

| Phase | Scope | Status |
|-------|-------|--------|
| 1 — Token layer | Truth Blue + refined Liquid Metal | ✅ |
| 2 — Page Header System | P0 routes | ✅ |
| 3 — Navigation & terminology | nav labels + page titles | ✅ |
| 4 — Component standardisation | canonical library (InsightCard, etc.) | ✅ |
| 5 — Deduplication | FontAwesome→Lucide, duplicates retired, colour sweep | ✅ |
| 6 — Charts | Question · Interpretation · Action + Truth Blue | ✅ |
| 7 — Audit | this report | ✅ |

**Route question coverage:** 31 page files carry a `PageHeader` business question (all operational
+ admin content routes). Excluded by design: auth/status pages (`landing`, `sign-in`, `sign-out`,
`no-access`, `pending-approval`, `setup-blocked`, `not-found`), onboarding/setup **wizards**, and POS
shift sub-flows — these are not standard content routes.

### 11.3 Backlog — final status

R1–R7, R10 ✅ done · R8 ✅ (already resolved) · R9 ✅ (P0 + admin routes; auth/wizard excepted) ·
R11 ◑ chrome clean; `README`/docs Midnight sweep still pending · R12 ⏳ `npm run test:a11y` not run
here (needs DATABASE_URL + Playwright) · R13 ⏸ orphan routes deferred by owner decision (§7.2).

### 11.4 Known deferred / out of scope (honest)

- **Onboarding / setup wizards** — page-header system not applied (would alter wizard workflow; approved skip).
- **Legacy light `:root`/`.dark` tokens** in `index.css` — retained; removal risks shadcn components rendered outside `.liquid-metal`. Deprecated, not deleted.
- **`settings/loyalty`, `settings/feature-flags`** — no clear page header to convert; not given a question subtitle.
- **`analytics-dashboard` "Recent Orders"** — static empty placeholder (honest, not fabricated); not data-wired (would be new logic).
- **`README.md` title + `docs/` historical** — still say "Midnight EPOS"/reference old brief names (non-chrome; rebrand plan marks archive docs historical).
- **a11y verification (R12)** — run `npm run test:a11y` in an environment with a database before release.

### 11.5 Verdict

**PASS.** The application conforms to the Arcarna Design System v1.0 across the audited surface;
all machine-checkable gates are green and the build is clean. Remaining items are deferred by
explicit decision or blocked by environment (a11y run) — none are regressions.
