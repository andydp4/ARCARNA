# ARCARNA™ Compliance Report

> **Agent 5 — QA Architect.** Audits the specification set for **contradiction, duplication,
> missing implementation detail, and brand compliance**, and registers the gap between the specs
> (target) and the current codebase. **Per the orchestration rule, implementation must not begin
> until this report passes.**
>
> **Verdict:** **CONDITIONAL PASS.** The five specs are internally consistent and
> implementation-ready. Two items require the owner's explicit sign-off before code begins (§7).

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
| Design direction consistent (Truth Blue, dark canvas, no metal, Inter) | ✅ Foundation §6 = Design System §1/§3 = Component surfaces |
| Route grouping consistent (6 groups) | ✅ Foundation/Language/Route/Component agree |
| Authority/reading order unambiguous | ✅ Foundation §0 defines precedence; no circular ownership |

**Resolved tension (flagged for sign-off — see §7).** The Design System brief mandates *removing
Liquid Metal/chrome and adopting Truth Blue*. This **contradicts** two existing repo artifacts:
`docs/ux-concepts/ARCARNA_UX_REDESIGN_BRIEF.md` ("Liquid Metal Industrial — Approved design
direction") and the orchestration line "Do not redesign the product." The specs treat the architect
briefs as the **newer, more specific approved direction** and scope the change to the *visual system
+ language* (not product capability/IA). This is internally consistent **but** supersedes a
previously "approved" direction, so it needs the owner's explicit confirmation before code.

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
| Midnight residue (user-facing) | ⚠ | `README.md` title "Midnight EPOS"; `docs/ARCHITECTURAL_PRINCIPLES.md` P13 "/midnight"; `liquid-metal.css` header comment references `MIDNIGHT_UX_REDESIGN_BRIEF.md`; `analytics/rfm.tsx` hardcoded `/midnight/api` |
| Forbidden language (SaaS/AI hype) | ✅ spec gate defined | Language §2/§18 grep gate |
| Colour = meaning only (N6) | ⚠ | `metric-card.tsx` decorative `text-accent bg-accent/10`; metal gradients are decorative |
| Single icon system (N7) | ⚠ | FontAwesome `@import` in `index.css`; `fas fa-*` in `home.tsx`, `metric-card.tsx` |
| Approved nav terms | ⚠ | `nav-items.ts` still "Dashboard", "Business Insights", etc. |

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
| N5 | No Midnight language | ✅ banned | ⚠ README/docs/rfm path (§4) |
| N6 | No decorative colour | ✅ colour=meaning | ⚠ `metric-card`, metal gradients |
| N7 | No duplicate term/component | ✅ ledgers | ⚠ headers/empty/KPI/icons (§3) |

---

## 7. Gate decision

**Documentation deliverable: COMPLETE and CONSISTENT.** All six required outputs exist; the five
specs pass contradiction/duplication/missing-detail checks at the document level.

**Implementation is BLOCKED until the owner confirms:**

1. **Direction sign-off (§2).** Approve replacing **Liquid Metal → Truth Blue on dark canvas** and
   retiring decorative chrome. This supersedes the previously "approved" Liquid Metal brief.
2. **Orphan-route decisions (Route §10).** For `/purchase-drafts`, `/audit-logs`, `/worker-logs`,
   `/rules`: add to nav (suggested groups given) or hide-by-role intentionally.

On those two confirmations, implementation may proceed against the specs and the §8 backlog.

---

## 8. Remediation backlog (code — for after sign-off)

| ID | Item | Spec | Severity |
|----|------|------|----------|
| R1 | Add Truth Blue token layer (`arcarna.css`); map shadcn vars; alias `lm-*` | Design §18 | High |
| R2 | Remove FontAwesome (`index.css` import + `home.tsx`/`metric-card.tsx`); migrate to Lucide | Design §9/§19 | High |
| R3 | Rebuild/retire `MetricCard` as `TruthCard` (tokens, state-only colour) | Component §5 | High |
| R4 | Converge page headers to one canonical `PageHeader` (title + question) | Component §3 | High |
| R5 | Re-group + rename `nav-items.ts` (6 groups, approved labels) | Route §14 / Language §3 | High |
| R6 | Flatten Liquid Metal surfaces (remove gradients/inner-shadows); Truth Blue buttons | Design §11–§13 | Medium |
| R7 | Convert `/reports`, `/analytics` render-aliases → redirects to `/insights` | Route §9 | Medium |
| R8 | Fix `analytics/rfm.tsx` `/midnight/api` → `apiFetch`/`resolveAppPath` | Route §6 / §4 | Medium |
| R9 | Add page `question` subtitle to every in-app route | Route §14 / Language §5 | Medium |
| R10 | Adopt `EmptyState` everywhere a CTA is needed; retire `EmptyStatePanel` (CTA) | Component §10 | Medium |
| R11 | Copy sweep: forbidden words + Midnight residue (README/docs/comments) | Language §18 | Medium |
| R12 | a11y verification on P0 routes after token change (`npm run test:a11y`) | Design §16 | Medium |
| R13 | Place/hide orphan routes per §7.2 decision | Route §10 | Low |

---

## 9. Sign-off

| Role | Output | Status |
|------|--------|--------|
| Foundation Architect | `ARCARNA_FOUNDATION_SPECIFICATION.md` | ✅ |
| Route Architect | `ARCARNA_ROUTE_EXPERIENCE_SPECIFICATION.md` | ✅ |
| Component Architect | `ARCARNA_COMPONENT_SPECIFICATION.md` | ✅ |
| Language Architect | `ARCARNA_LANGUAGE_SPECIFICATION.md` | ✅ |
| Design System Architect | `ARCARNA_DESIGN_SYSTEM_SPECIFICATION.md` | ✅ |
| QA Architect | `ARCARNA_COMPLIANCE_REPORT.md` | ✅ (conditional — §7) |

**Owner action required:** confirm §7.1 (direction) and §7.2 (orphan routes) to unblock implementation.
