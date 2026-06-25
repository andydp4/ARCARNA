# ARCARNA™ Component Specification

> **Agent 2 — Component Architect.** Subordinate to
> [`ARCARNA_FOUNDATION_SPECIFICATION.md`](./ARCARNA_FOUNDATION_SPECIFICATION.md); consumes the
> [Design System](./ARCARNA_DESIGN_SYSTEM_SPECIFICATION.md) (tokens/surfaces) and the
> [Language](./ARCARNA_LANGUAGE_SPECIFICATION.md) (copy/terminology) specs.
>
> **Critical rule:** components are **business interactions, not decoration**. Every component must
> support **understanding, trust, action, or empowerment** (Foundation §5). A component that does
> none of these does not ship.
>
> Documents the existing library at [`client/src/components/`](../../client/src/components/) (47 ui
> primitives + ~60 feature components). It does not invent product capability (Foundation §15.4).

---

## 1. Component hierarchy

| Tier | Definition | Examples |
|------|-----------|----------|
| **Primitives** | shadcn/ui, restyled via tokens. Never forked. | `ui/button`, `ui/dialog`, `ui/table`, `ui/select` (47 files) |
| **Shell** | App frame, present on every authed route. | `Layout`, `BrandLogo`, `OrgSwitcher`, `Signals` (`NotificationCenter`), `CommandPalette`, `PwaInstallBanner` |
| **Truth** | Reveal → Explain → Guide surfaces. | `TruthCard` (KPI), `BusinessHealthSection`, `ActivityTimeline`, charts |
| **Pattern** | Reused scaffolding. | `PageHeader` (canonical), `EmptyState`, `Skeleton`, `ConfirmDestructive`, `DataTableShell`, `BulkActionBar`, `ViewSelector` |
| **Feature** | Domain UI. | `pos-*`, `dashboard/*`, `spatial/*`, `assistant/*`, `charts/*`, `inventory/*`, `settings/*`, `whatsapp/*` |

## 2. Shell / navigation components

- **`Layout`** ([`Layout.tsx`](../../client/src/components/Layout.tsx)) — app frame; renders the
  global theme scope, header, sidebar, and always-on `WhatsAppPanel` + `ArcarnaAssistantBar`.
  Nav is grouped per Foundation/Route: **Control Centre · Sell · Stock · Understand · Operate ·
  Administer** (replaces the flat list in `nav-items.ts`). `User Access` visible to `SUPER_ADMIN`/
  `ADMIN` only. Every control ≥ 44px; icon buttons carry `aria-label`; active item uses the Truth
  Blue active treatment (Design System §11).
- **`BrandLogo`** — `mark` / `wordmark` variants from official assets; never redrawn. Placement map:
  [`docs/REBRAND_ARCARNA.md`](../REBRAND_ARCARNA.md).
- **`OrgSwitcher`** — business switch; persists `arcarna.selectedOrgId`. Chrome says "business", not "org".
- **`CommandPalette`** — fast navigation/actions; recents under `arcarna-command-palette-recent`.

## 3. PageHeader specification (canonical — resolves a duplicate)

Two header components exist today — `AppPageHeader` (`app-page-header.tsx`) and `PageHeader`
(`PageHeader.tsx`). **Converge on one canonical `PageHeader`** (Foundation §15.1).

**Canonical contract:**
```
PageHeader({
  title,        // = approved nav label (Language §4); one H1
  question,     // = the route's question (Language §5); rendered as subtitle
  eyebrow?,     // group name, e.g. "Understand"
  icon?,        // Lucide
  actions?,     // primary action / Next Move (right-aligned)
})
```
- `title` **must** equal the nav label; `question` **must** be present on every in-app route.
- Adopt `AppPageHeader`'s richer shape (eyebrow + actions) as the canonical; migrate `PageHeader`
  usages; re-export the shared `LM_CARD`→`SURFACE_CARD` constant from one module.

## 4. Business Truth components

The heart of the product — they execute **Reveal → Explain → Guide** (Foundation §12).

| Component | Reveal | Explain | Guide |
|-----------|--------|---------|-------|
| **`TruthCard`** (KPI, §5) | headline number/state | one-line delta vs comparison window | Next Move link |
| **`BusinessHealthSection`** ([`BusinessHealthSection.tsx`](../../client/src/components/BusinessHealthSection.tsx)) | health summary | contributing factors | jump to the weak area |
| **`ActivityTimeline`** ([`activity-timeline.tsx`](../../client/src/components/activity-timeline.tsx)) | what just happened | context per event | open the related record |
| **Charts** (§8) | the shape of the data | axis/label evidence | drill to detail |

**Rule:** a Truth component must name the truth in words, not only draw it. A chart with no stated
truth is decoration and fails the critical rule.

## 5. KPI cards (`TruthCard`) — resolves a duplicate + compliance defect

Today there are two: `DailyKpiCard` (`dashboard/DailyKpiCard.tsx`, canonical) and `MetricCard`
(`metric-card.tsx`, **non-compliant**: light-theme tokens, decorative `text-accent` pill,
FontAwesome).

**Canonical `TruthCard`:**
- Surface `--surface` + `--border` (Design System §12); **no** metal gradient.
- Value: large `tabular-nums` (`--text`). Label: `--text-muted`. Lucide icon.
- One **meaningful** delta only (Truth Blue or a state colour) tied to a real comparison window —
  a *truth*, not a decorative badge.
- Optional Next Move link.

**Mandate:** retire `MetricCard` or rebuild it on `TruthCard`. Remove FontAwesome + light tokens.

## 6. Quick actions

- `QuickActionCard` (`dashboard/QuickActionCard.tsx`) and the Control Centre quick-action grid.
- Each is a **verb + noun** route shortcut (Language §6) with a Lucide icon — the owner's common
  Next Moves. Migrate `home.tsx`'s `fas fa-*` quick actions to Lucide.
- Quick actions are utility, not decoration: only surface actions the owner actually takes often.

## 7. Tables

- `DataTableShell` + `ui/table`, with `BulkActionBar` and `ViewSelector`.
- Dense, scannable; header `--text-muted` uppercase; selected row `--truth-blue-subtle`; numerics
  right-aligned `tabular-nums` (Design System §13).
- **Mobile:** stack to operational cards (no horizontal scroll).
- Every table answers "what needs my attention?" — sort/most-urgent-first, not alphabetical by default.

## 8. Charts

- `charts/RfmHeatmap`, `charts/HourHeatmap`, `charts/PromoLiftChart`; `analytics-dashboard`,
  `daily-revenue-chart`, `monthly-orders-chart`.
- Single-hue-first palette; Truth Blue primary series; state colours only where the value *is* a
  state (Design System §10). Always pair colour with a label/legend.
- Each chart carries a one-line stated truth and a drill path (Guide).

## 9. Modals

- Built on `ui/dialog` / `ui/alert-dialog` / `ui/sheet` / `ui/drawer`.
- **`ConfirmDestructive`** required for delete/void/refund/irreversible actions. Title = decision,
  body = consequence, confirm button names the consequence (`--danger`). Copy per Language §10.
- **`UnsavedChangesAlert`** guards navigation away from dirty forms.
- Focus-trapped; `Esc` closes; one decision per modal.

## 10. Empty states (canonical `EmptyState`)

- `EmptyState` (`EmptyState.tsx`) is canonical when a CTA is required; `EmptyStatePanel` is legacy
  (keep only where used). Foundation §15.1 dedup.
- Title → body → primary CTA (and optional secondary); `role="status"`; CTAs ≥ 44px.
- **No dead ends:** every empty state offers a first move (Foundation §4). Distinguish "no data" vs
  "no matches" (Language §9). Replace inline `hsl()` literals with tokens.

## 11. Notification Center → **Signals**

- `NotificationCenter` is the **Signals** surface. A signal = a truth that needs attention now
  (low stock, overdue invoice, unprocessed goods receipt — see [`docs/ARCARNA_VOICE.md`](../ARCARNA_VOICE.md)
  alerts feed).
- **Calm, never alarmist** (Language §2). Each signal: what it is, why it matters, and a Next Move.
- Dismissed state persists under `arcarna.notifications.dismissed`. Severity uses state colour
  **with** an icon/label, never colour alone.

## 12. Toasts

- `ui/toast` + `Toaster`. Confirm outcomes briefly: "Order saved.", "Refund issued — £24.00."
- Success/error use state colour **and** icon. No celebration language; no exclamation unless real
  urgency (Language §7). Auto-dismiss; never trap focus.

## 13. Settings components

- `settings/ImportsHub`, `settings/SuppliersHub`, `settings/WhatsAppSettings`; `OrgNameSettings`,
  `settings/receipts`, `settings/loyalty`, `settings/developer`.
- Each setting states what it changes, in the owner's words ("your business", "your team").
- Forms guard unsaved changes; destructive settings confirm. No "tenant"/"org" in chrome.

## 14. Onboarding components

- `OnboardingResumeBanner`, `onboarding`, `onboarding-wizard`, `setup-wizard`.
- One step / one ask; visible progress; resume always available ("Pick up where you left off.").
- Frames setup as revealing the business, not configuring software (Language §14). Ends at the
  Control Centre ("You're set up. Here's your Control Centre.").

## 15. AI Assistant components → **Arcarna Voice**

- `assistant/ArcarnaAssistantBar` — floating command/voice bar, always-on in `Layout`.
- **Rule-based, deterministic; never labelled "AI"** (Foundation §9). Always confirms before a real
  write. One step at a time; spoken-first copy (Language §11).
- Visual: quiet surface, Truth Blue active state; no "magic" sparkle/glow.

## 16. POS / order components (`Create Order`)

- `pos-product-card`, `pos-cart-panel`, plus POS shell surfaces; `Orders`/`orders-row`/
  `orders-skeleton`; `ZReport` (shift Z-report); `OrderRefundPage`.
- Selling is the highest-priority flow: instant search, barcode, large touch targets, optimistic
  add-to-cart. Price text is neutral (`--text`/Truth Blue), **not** a state colour.
- Availability/stock state via state colour **with text**. Refund/void go through `ConfirmDestructive`.

## 17. Customer components

- `Customers`, `top-customers-table`, `customers` detail; loyalty/gift-card/promotion surfaces in
  the **Operate** group.
- Answer "who buys from you, and what are they worth?" — surface recency/frequency/value (links to
  Customer Segments / RFM). Communication history visible. Speed prioritised.

## 18. Inventory components

- `inventory/ReceivingTab`, `inventory/ReplenishmentTab`, `inventory/SmartStockTab`,
  `inventory/TransfersTab`; `Products`/`ProductManagement`; `PurchaseDraftsPage`.
- Reveal stock truth fast: in stock / low / out via state colour + label. Quick adjustments and
  scanning. "Smart Stock" describes the rule-based replenishment — not "AI" (Language §11).

## 19. Report / Evidence components

- Reporting surfaces (`Insights`/Truths, `analytics/*`, `expense-reports`/Profit Analysis,
  `scheduled-reports`/Scheduled Evidence) and `reporting-skeletons`.
- The noun is **Evidence**; actions "Export evidence", "Schedule evidence" (Language §12).
- Each piece of evidence ties to a **Truth** it proves and offers a Next Move.

## 20. Component maturity model

| Level | Definition | Gate to next |
|-------|-----------|--------------|
| **L0 — Legacy** | Old direction (metal/FontAwesome/light tokens) or duplicate. e.g. `MetricCard`, `PageHeader`(dup), `EmptyStatePanel`(CTA), FontAwesome icons. | Migrate to tokens + dedupe. |
| **L1 — Compliant** | Uses Design System tokens, Lucide, approved copy; passes a11y. | Add Reveal→Explain→Guide where it's a Truth surface. |
| **L2 — Truth-bearing** | States its truth in words and offers a Next Move (no dead end). | — |
| **L3 — Canonical** | The single approved component for its job; in the dedup ledger as "keep". | Maintain; no rivals. |

Target: all shell/pattern/Truth components at **L3**; all feature components ≥ **L1**, Truth-facing ones at **L2+**.

## 21. Deduplication ledger + acceptance criteria

**Ledger (Foundation §15.1 — must resolve):**

| Concept | Keep (canonical) | Retire / migrate |
|---------|------------------|------------------|
| Page header | `PageHeader` (canonical contract §3) | duplicate header component |
| Empty state | `EmptyState` | `EmptyStatePanel` (legacy only) |
| KPI / Truth card | `TruthCard` / `DailyKpiCard` | `MetricCard` (as-is) |
| Icon system | `lucide-react` | FontAwesome (`fas fa-*`) |

**Acceptance criteria:**
- [ ] Every component supports understanding, trust, action, or empowerment (critical rule).
- [ ] One canonical component per job; ledger duplicates retired/migrated.
- [ ] Truth surfaces follow Reveal → Explain → Guide and **state their truth in words**.
- [ ] All components consume Design System tokens (no metal/FontAwesome/light tokens; §19 of Design System clear).
- [ ] Page headers carry `title` (nav label) + `question` (route question).
- [ ] Empty states / modals / signals / toasts follow Language §7–§11.
- [ ] a11y: ≥44px targets, `aria-label` on icon controls, state never by colour alone; `npm run test:a11y` green.
