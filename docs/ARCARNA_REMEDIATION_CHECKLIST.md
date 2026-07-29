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
- [x] **X-P2-03** docs Midnight→Arcarna sweep (14 user-facing guides: product-name prose → Arcarna; kept legacy technical refs — `X-Midnight-Signature`, `/root/MidnightEPOS` paths, migration ground-truth, compliance/rebrand-meta docs)

## Batch 2 — Chart colour tokens (T-P1-02..06)

- [x] **T-P1-02/03** Shared brand palette `client/src/lib/chartColors.ts`; replaced all hardcoded `COLORS`/hex in `insights.tsx` + `expense-reports.tsx` (other two chart files were already hex-free)
- [x] **C-P1-03 (extra)** Fixed 4 more `en-US`/`USD` currency formatters missed by the audit → `en-GB`/`GBP` (`expense-reports.tsx`, `expenses.tsx`, `expense-row.tsx`) + `daily-revenue-chart` date locale
- [x] **T-P1-04** RFM + stock-turn badges → shared semantic classes (`.badge-success/-warning/-danger/-info/-neutral` in `tokens/arcarna.css`)
- [x] **T-P1-05** MOOT — no `metric-card` component exists any more (removed in an earlier refactor); nothing to fix
- [x] **T-P1-06** `offline-indicator` → semantic tokens; `bg-green-50` was rendering a near-white slab on the dark shell
- [x] **T-P1-08** setup-wizard default accent `#6366f1` → Truth Blue `#1A56DB`

## Batch 3 — Settings trust (S-P0-01/02, T-P1-07)

- [x] **S-P0-01** Browser-local vs account-backed settings labelled; button reads "Save to this browser" (PR #88)
- [x] **S-P0-02** Mock Users tab removed — it toasted "User approved successfully" while doing nothing; now links to User Access (PR #88)
- [x] **T-P1-07** Dead light/dark toggle removed (Liquid Metal tokens live on :root, so it changed nothing) (PR #88)

## Batch 4 — Toast / modal / copy standards (C-P1-01/02/04, K-P0-02/03)

- [~] **C-P1-01** Toast title standardisation — failure titles normalised to sentence case across `client/src/pages` (PR #80); remaining success-title phrasing variance accepted as cosmetic
- [ ] **C-P1-04** Sentence-case pass on modal/button titles
- [x] **K-P0-02** VERIFIED ALREADY DONE — P0 empty states already distinguish empty vs filtered vs no-match, each with icon, body copy and (where useful) a CTA
- [x] **K-P0-03** Two native browser `confirm()` deletes (customers, products) replaced with branded ConfirmDestructive naming the record and its consequence; tick-list copy de-vagued; `requireTyping`/`confirmLabel` added so single deletes get a verb button without type-to-confirm friction

## Batch 5 — "Truths" lexicon rebrand (DECISION: approved; "Signals" rejected → Notifications stays)

Centralise vocabulary in one module, then apply to nav + page headers.

- [x] **C-P0-01** Vocabulary module `client/src/lib/vocabulary.ts` (single source)
- [x] **R-P0-07 / K-P0-04** Applied: nav + page headers → Control Centre, Truths Hub, Stock Truths, Customer Truths, Profit Truths, Business Truths (home/insights/inventory/rfm/expense-reports/BusinessHealthSection/SpatialInsightsShell)
- [x] **C-P0-02/03 / C-P1-09** Command palette: "Open POS terminal"→"Create Order", "Open business insights"→"Open Truths Hub"; home "Analytics Overview"→"Truths Overview"
- [x] **K-P0-05** Notifications→Signals — **DROPPED** by owner; "Notifications" stays. No action.
- [ ] **R-P0-04** 6-group sidebar IA — deferred (larger reorg, separate from renames)
- [x] **O-P0-01/02** Onboarding → "Discovery Journey" (PR #79)
- [ ] **P1 renames** shifts/channels/hour-of-day/promotions/scheduled-reports/tick-list/developer, assistant voice rules
- [x] **C-P0-02/03** Last five user-facing "Open POS" labels → "Create Order" (insights + orders empty-state CTAs, onboarding wizard x3)
- [ ] **PageHeader contract (K-P0-01)** title + question subtitle + action slot, applied to P0 routes

## Batch 6 — Docs / repo hygiene (X-P2-01/03) + branches

- [x] **X-P2-01** Commit audit + this checklist to `docs/`
- [ ] Aggressive stale-branch cleanup (merged + closed-PR + dead cursor/* investigation branches; verify no open PR first)
- [x] `attached_assets/` + `handoff/` — archived to `archive/legacy/2026-07-pre-arcarna/` with 6 dead scripts (PR #90)

## Dependencies (fix all except vite 5→8)

**Finding (verified twice):** this lockfile is at a *local minimum* of advisories.
Any refresh churns newer transitive deps that ADD advisories:
- `npm audit fix` → 33 → 62
- manual scoped overrides + `postcss` bump + install → 33 → 63

Piecemeal fixing is counter-productive. All critical/high are **dev/build/test
tooling** (vite, vitest, postcss, eslint's js-yaml/brace-expansion) — **no
production-runtime exposure**. Correct fix = one deliberate, holistic dev-tooling
upgrade with a full test run, i.e. bundle these INTO the deferred vite/vitest work.

- [x] `postcss`, `js-yaml`, `brace-expansion` — resolved by the vite 8 upgrade
- [x] `vitest →4`, `vite 5→8` — **DONE**: vite@8.1.5 + plugin-react@5 + vitest@4 (+ esbuild 0.28, @types/node ^22 peers). Audit 33 → 28, critical cleared, build 13s → 2.4s. See `docs/VITE_UPGRADE_PLAN.md`.
- [ ] `exceljs/uuid`, Sentry/OpenTelemetry cluster, `drizzle-kit` — remaining 28 advisories, each its own upgrade.

---

## Notes

- `npm audit fix` **regresses** this tree (33→62 advisories) — use pinned `overrides` instead.
- Midnight docs sweep must NOT touch intentional legacy identifiers (webhook header, DB/backup names, migration comments) — only user-facing prose. CI guard covers `client/` + `server/templates/`.
- All critical/high advisories are dev/build/test tooling — no production runtime exposure.
