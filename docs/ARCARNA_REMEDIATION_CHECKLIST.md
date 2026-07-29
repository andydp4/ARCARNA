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
- [x] **C-P1-04** 29 dialog titles + button labels sentence-cased; proper nouns, acronyms, Z-Report and vendored shadcn primitives left alone
- [x] **K-P0-02** VERIFIED ALREADY DONE — P0 empty states already distinguish empty vs filtered vs no-match, each with icon, body copy and (where useful) a CTA
- [x] **K-P0-03** Two native browser `confirm()` deletes (customers, products) replaced with branded ConfirmDestructive naming the record and its consequence; tick-list copy de-vagued; `requireTyping`/`confirmLabel` added so single deletes get a verb button without type-to-confirm friction

## Batch 5 — "Truths" lexicon rebrand (DECISION: approved; "Signals" rejected → Notifications stays)

Centralise vocabulary in one module, then apply to nav + page headers.

- [x] **C-P0-01** Vocabulary module `client/src/lib/vocabulary.ts` (single source)
- [x] **R-P0-07 / K-P0-04** Applied: nav + page headers → Control Centre, Truths Hub, Stock Truths, Customer Truths, Profit Truths, Business Truths (home/insights/inventory/rfm/expense-reports/BusinessHealthSection/SpatialInsightsShell)
- [x] **C-P0-02/03 / C-P1-09** Command palette: "Open POS terminal"→"Create Order", "Open business insights"→"Open Truths Hub"; home "Analytics Overview"→"Truths Overview"
- [x] **K-P0-05** Notifications→Signals — **DROPPED** by owner; "Notifications" stays. No action.
- [x] **R-P0-04** 6-group sidebar IA — Control Centre / Sell / Stock / Understand / Operate / Administer. Removed 4 duplicate nav entries, surfaced 4 orphan routes (purchase-drafts, audit-logs, worker-logs, rules), admin-gated the log/rules routes, fixed labels overflowing the collapsed rail. Truths lexicon kept over the stale spec table — see `docs/NAV_STRUCTURE_PROPOSAL.md`.
- [x] **O-P0-01/02** Onboarding → "Discovery Journey" (PR #79)
- [x] **P1 renames** applied via the nav rebuild (Busiest Hours, Order Channels, Stock Turn, Scheduled Evidence, Purchase Drafts, Audit Log, System Activity, Rules)
- [x] **C-P0-02/03** Last five user-facing "Open POS" labels → "Create Order" (insights + orders empty-state CTAs, onboarding wizard x3)
- [x] **PageHeader contract (K-P0-01)** action slot applied across P0 routes (title/question/explanation were already in place); hand-rolled sibling action rows replaced

## Batch 6 — Docs / repo hygiene (X-P2-01/03) + branches

- [x] **X-P2-01** Commit audit + this checklist to `docs/`
- [~] Stale-branch cleanup — the 3 last open cursor drafts (#50/#52/#53) reviewed and closed as superseded by #77/#86, so all 20 `cursor/critical-bug-*` branches are now PR-free. Deletion itself must run outside the agent (branch deletes are blocked through the git proxy): run `scripts/cleanup-stale-branches.sh`. 67 remote branches today.
- [x] `attached_assets/` + `handoff/` — archived to `archive/legacy/2026-07-pre-arcarna/` with 6 dead scripts (PR #90)

## Dependencies (fix all except vite 5→8)

**Finding (verified twice):** this lockfile is at a *local minimum* of advisories.
Any *blanket* refresh churns newer transitive deps that ADD advisories:
- `npm audit fix` → 33 → 62
- manual scoped overrides + `postcss` bump + install → 33 → 63

Blanket fixing (`audit fix`, `--force`, bumping everything at once) is
counter-productive on this tree. **Correction (this round):** narrow,
per-package fixing — upgrade or override exactly the flagged package, verify
the audit count and full gate suite after each one, revert anything that
regresses — is not counter-productive; it took 28 → 5 with zero regressions.
The difference is doing one deliberate change at a time instead of letting
npm's resolver churn the whole tree.

- [x] `postcss` — resolved by the vite 8 upgrade
- [x] `vitest →4`, `vite 5→8` — **DONE**: vite@8.1.5 + plugin-react@5 + vitest@4 (+ esbuild 0.28, @types/node ^22 peers). Audit 33 → 28, critical cleared, build 13s → 2.4s. See `docs/VITE_UPGRADE_PLAN.md`.
- [x] Sentry/OpenTelemetry cluster — **DONE**: `@sentry/node` + `@sentry/react` 8.55.2 → 10.68.0 (skips v9 straight to 10.68.0, the first line with patched OTel deps). Clears all ~19 `@opentelemetry/*` + `@sentry/opentelemetry` + `@prisma/instrumentation` moderates. Checked against the SDK's v8→v9 and v9→v10 migration guides — nothing removed/changed applies to our usage (server: `init`/`withIsolationScope`/`captureException`; client: `init`/`browserTracingIntegration`/`replayIntegration`/`ErrorBoundary`, no `onError`/`onReset`). Node 22 and TS 5.6.3 clear the new v9 minimums (Node ≥18, TS ≥5.0.4).
- [x] `exceljs/uuid` — **DONE**: scoped `overrides.uuid: ^11.1.1`. exceljs pins `uuid@^8.3.0` even in its own latest release — no exceljs version bump fixes this. Its entire usage is one zero-argument `uuid.v4()` call (`cf-rule-ext-xform.js`), API-identical from uuid 8.x through 11.x; confirmed by resolving `require('uuid')` from exceljs's own file location and round-tripping a workbook write/read.
- [x] `js-yaml` (eslint chain), `body-parser` (express chain) — **DONE**, found opportunistically while verifying the above (not one of the three original clusters). Both are single-path, already-in-range patch bumps, not major forcing: eslint declares `"js-yaml": "^4.1.0"` (permits patched 4.3.0) and express declares `"body-parser": "^2.2.1"` (permits patched 2.3.0) — npm just hadn't re-resolved to them. The js-yaml override is scoped to eslint's own subtree specifically so it does NOT touch the unrelated `ts-jest → babel-plugin-istanbul → @istanbuljs/load-nyc-config` chain, which pins a real `^3.13.1`-only range that would break if forced onto 4.x.
  - Correction to the old `[x]` claim on this line: js-yaml/brace-expansion were **not** actually cleared by the vite 8 upgrade — both were still present in the 28-advisory baseline this round started from. js-yaml is fixed now (above); brace-expansion is not (below).
- [ ] `brace-expansion` — **BLOCKED, left as-is.** GHSA-mh99-v99m-4gvg (unbounded expansion length) flags every version `<=5.0.7` regardless of major line, so the only clean fix is forcing every consumer to `5.0.8`. But the three `minimatch` major lines pulling it into this tree each declare an incompatible range for it — `minimatch@3.1.5 → "^1.1.7"` (eslint, eslint-plugin-jsx-a11y, eslint-plugin-react, exceljs's archiver/unzipper chain), `minimatch@9.0.9 → "^2.0.2"` (tailwindcss), `minimatch@10.2.5 → "^5.0.5"` (@typescript-eslint/parser, @sentry/vite-plugin) — so a blanket override forces at least two of those three onto a major they didn't ask for. That is the same shape of change that produced the documented 33→63 regression. Dev/build-tooling only, no production runtime exposure. Left unresolved.
- [ ] `drizzle-kit` — **BLOCKED, left as-is.** The deprecated `@esbuild-kit/esm-loader` / `esbuild<=0.24.2` chain is only dropped in the `1.0.0` prerelease line (tested `1.0.0-rc.4`); drizzle-kit's own `latest` dist-tag is still `0.31.10` with the same vulnerable chain — there is no *stable* release that fixes this. Worse: `drizzle-kit@1.0.0-rc.4` requires a `drizzle-orm` export subpath (`./_relations`) that our `drizzle-orm@0.45.2` doesn't provide (it only exports `./relations`) — confirmed by running `npx drizzle-kit generate`, which crashes with `Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './_relations' is not defined by "exports" in .../drizzle-orm/package.json`. `drizzle-orm` is a **production runtime** dependency (unlike drizzle-kit), so clearing this cluster would mean a coordinated ORM major bump too — well beyond a dev-tooling-only fix, and onto software the upstream project hasn't itself shipped as stable. Deferred.

**Result this round: 28 → 5 advisories** (1 low, 25 moderate, 2 high → 0 low, 4 moderate, 1 high), zero regressions, full gate suite green throughout (`tsc --noEmit`, `npm run build`, `npm test` — 191 pass/3 skipped, `npm install --dry-run` clean on a from-scratch `node_modules`). Remaining 5 are drizzle-kit's esbuild-kit chain (4 moderate) and brace-expansion (1 high) — both dev/build-tooling only, no production runtime exposure, both blocked on upstream as detailed above.

---

## Notes

- `npm audit fix` **regresses** this tree (33→62 advisories) — use pinned `overrides` instead.
- Midnight docs sweep must NOT touch intentional legacy identifiers (webhook header, DB/backup names, migration comments) — only user-facing prose. CI guard covers `client/` + `server/templates/`.
- All critical/high advisories are dev/build/test tooling — no production runtime exposure.
