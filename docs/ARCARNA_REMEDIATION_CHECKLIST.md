# ARCARNA Remediation Checklist (verified & tracked)

Living tracker for the Experience Audit remediation. Status is verified against
the code at the commit noted, not the audit's stale baseline (`882a380`).

**Legend:** `[x]` done · `[ ]` outstanding · `[~]` partial · `DECISION` = needs product/brand sign-off

Approved direction (owner, this session): implement **everything**, including the
"Truths" lexicon rebrand; fix **all** dependency advisories **except** the
`vite 5→8` upgrade (deferred); aggressive stale-branch cleanup.

---

## Already done (audit was stale)

- [x] **B-P0-01** `/brand/` assets exist (`client/public/brand/arcarna-mark.png`, `arcarna-wordmark.png`, lockups)
- [x] **R-P0-01** orphan `reports.tsx` removed (absent, not in `App.tsx`)
- [x] **R-P0-03** Orders page H1 already `"Open Orders"` (matches nav)
- [x] **X-P2-02** `scripts/check-brand-strings.sh` CI guard exists
- [x] **T-P1-09** Font Awesome gone — `client/src` is Lucide-only

---

## Batch 1 — Midnight→Arcarna data + UK copy (no design decision)

- [x] **D-P1-01** `scripts/seed.ts`: `Midnight Demo Org` → `Arcarna Demo Org`; `store@midnight-demo.local` → `store@arcarna-demo.local`
- [x] **C-P1-03** UK copy: `insights.tsx` `Revenue ($)` → `Revenue (£)`; `settings.tsx` `State, ZIP`/`+1 …` placeholders → County/Postcode/`+44 …`
- [ ] **X-P2-03** docs Midnight→Arcarna sweep (user-facing docs only; keep legacy technical refs like `X-Midnight-Signature`, DB names)

## Batch 2 — Chart colour tokens (T-P1-02..06)

- [ ] **T-P1-02/03** Replace scattered `COLORS = ['#3B82F6', …]` / inline hex in `insights.tsx`, `expense-reports.tsx`, `daily-revenue-chart.tsx`, `monthly-orders-chart.tsx` with a shared brand palette (`client/src/lib/chartColors.ts`, mirroring `--chart-*` Truth Blue tokens)
- [ ] **T-P1-04** RFM / stock-turn badge colours → semantic brand tokens (not `emerald-500/15`)
- [ ] **T-P1-05** `metric-card` remove light gradient on dark shell
- [ ] **T-P1-06** `offline-indicator` dark tokens (no `green-50/orange-50`)
- [ ] **T-P1-08** setup-wizard default accent `#6366f1` → Truth Blue token

## Batch 3 — Settings trust (S-P0-01/02, T-P1-07)

- [ ] **S-P0-01** Label localStorage-only settings vs API-backed
- [ ] **S-P0-02** Remove/hard-gate mock Users tab (real path = User Access)
- [ ] **T-P1-07** Remove or fix the Dark Mode toggle (always-dark app)

## Batch 4 — Toast / modal / copy standards (C-P1-01/02/04, K-P0-02/03)

- [ ] **C-P1-01** Toast title standardisation (~40 sites): Success/Error phrasing
- [ ] **C-P1-04** Sentence-case pass on modal/button titles
- [ ] **K-P0-02** EmptyState context-specific copy on P0 pages
- [ ] **K-P0-03** ConfirmDestructive: title + consequence + specific verb

## Batch 5 — "Truths" lexicon rebrand (DECISION: approved)

Centralise vocabulary in one module, then apply to nav + page headers.

- [ ] **C-P0-01** Vocabulary constants module (single source)
- [ ] **R-P0-04** Sidebar into 6 groups (Control Centre · Sell · Stock · Understand · Operate · Administer)
- [ ] **R-P0-03/07, K-P0-01/04/05** Rename surfaces: Dashboard→Control Centre, Insights→Truths Hub, Inventory→Stock Truths, RFM→Customer Truths, Expense reports→Profit Truths, Notifications→Signals, Business Health→Business Truths
- [ ] **C-P0-02/03** Home quick-action "Reports"→Truths Hub; POS wording → "Create Order" only
- [ ] **O-P0-01/02** Onboarding → "Discovery Journey"; step labels to spec
- [ ] **P1 renames** shifts/channels/hour-of-day/promotions/scheduled-reports/tick-list/developer, command palette, assistant voice rules
- [ ] **PageHeader contract (K-P0-01)** title + question subtitle + action slot, applied to P0 routes

## Batch 6 — Docs / repo hygiene (X-P2-01/03) + branches

- [x] **X-P2-01** Commit audit + this checklist to `docs/`
- [ ] Aggressive stale-branch cleanup (merged + closed-PR + dead cursor/* investigation branches; verify no open PR first)
- [ ] `attached_assets/` + `handoff/` review

## Dependencies (fix all except vite 5→8)

- [ ] `postcss`, `js-yaml`, `brace-expansion` — via targeted `overrides` (NOT `npm audit fix`, which regresses 33→62)
- [ ] `vitest →4`, `exceljs/uuid` — breaking, do with test run
- [ ] **DEFERRED** `vite 5→8` — separate task, after the above

---

## Notes

- `npm audit fix` **regresses** this tree (33→62 advisories) — use pinned `overrides` instead.
- Midnight docs sweep must NOT touch intentional legacy identifiers (webhook header, DB/backup names, migration comments) — only user-facing prose. CI guard covers `client/` + `server/templates/`.
- All critical/high advisories are dev/build/test tooling — no production runtime exposure.
