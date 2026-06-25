# ARCARNA™ Compliance Report

> **Agent 5 — QA Architect.** Audits the specification set for **contradiction, duplication,
> missing implementation detail, and brand compliance**, and registers the gap between the specs
> (target) and the current codebase. **Per the orchestration rule, implementation must not begin
> until this report passes.**
>
> **Verdict:** **CONDITIONAL PASS.** The five specs are internally consistent and
> implementation-ready. The visual-direction question is **resolved** (owner: refine Liquid Metal +
> Truth Blue — §2/§7). **One** item remains for sign-off before code begins: orphan-route placement (§7).

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

**Resolved:**

1. ✅ **Direction (§2).** Owner decision: **refine Liquid Metal + Truth Blue accent** (do not
   replace). Specs updated; no contradiction remains.

**One item remains before implementation:**

2. **Orphan-route decisions (Route §10).** For `/purchase-drafts`, `/audit-logs`, `/worker-logs`,
   `/rules`: add to nav (suggested groups given) or hide-by-role intentionally.

On that confirmation, implementation may proceed against the specs and the §8 backlog (R1–R13).

---

## 8. Remediation backlog (code — for after sign-off)

| ID | Item | Spec | Severity |
|----|------|------|----------|
| R1 | Add Truth Blue token layer (`arcarna.css`); map shadcn vars; alias `lm-*` | Design §18 | High |
| R2 | Remove FontAwesome (19 occ / 5 files: `index.css`, `home.tsx`, `top-customers-table.tsx`, `metric-card.tsx`, `analytics-dashboard.tsx`); migrate to Lucide | Design §9/§19 | High |
| R3 | Rebuild/retire `MetricCard` as `TruthCard` (tokens, state-only colour) | Component §5 | High |
| R4 | Converge page headers to one canonical `PageHeader` (title + question) | Component §3 | High |
| R5 | Re-group + rename `nav-items.ts` (6 groups, approved labels) | Route §14 / Language §3 | High |
| R6 | **Refine** Liquid Metal surfaces (reduce shine/excess gradient, **retain** material); retire `lm-btn-metal` mirror fill; Truth Blue primary + selection | Design §3.5/§8/§11–§13 | Medium |
| R7 | Convert `/reports`, `/analytics` render-aliases → redirects to `/insights` | Route §9 | Medium |
| ~~R8~~ | ~~Fix `analytics/rfm.tsx` `/midnight/api`~~ — **already resolved** (measured 0 hits) | Route §6 / §4 | Done |
| R9 | Add page `question` subtitle to every in-app route | Route §14 / Language §5 | Medium |
| R10 | Adopt `EmptyState` everywhere a CTA is needed; retire `EmptyStatePanel` (CTA) | Component §10 | Medium |
| R11 | Copy sweep: forbidden words + Midnight residue (README/docs/comments) | Language §18 | Medium |
| R12 | a11y verification on P0 routes after token change (`npm run test:a11y`) | Design §16 | Medium |
| R13 | Place/hide orphan routes per §7.2 decision | Route §10 | Low |

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
