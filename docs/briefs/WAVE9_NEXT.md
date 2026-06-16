# Wave 9 — Next work (8b + 9)

**Prerequisite:** Wave 8 on `main` (**P10d** Playwright smoke, **P10b** Plausible, **U5** axe critical-path tests + `docs/ACCESSIBILITY.md`).

**Canonical briefs:** [`PHASE_U_UX_POLISH.md`](./PHASE_U_UX_POLISH.md) (U6, U7, U5 eslint), [`PHASE_E_LIQUID_METAL.md`](./PHASE_E_LIQUID_METAL.md) (E2), [`PHASE_F_FEATURES.md`](./PHASE_F_FEATURES.md) (029/F6), [`PHASE_P10_PLATFORM.md`](./PHASE_P10_PLATFORM.md) (P10b), [`PHASE_O_OPS.md`](./PHASE_O_OPS.md) (O1–O3).

**Pre-wave snags (optional):** [`GAPS_BACKLOG.md`](./GAPS_BACKLOG.md) — U1/U4/U5/H1/E2 items you may close before or alongside Wave 9.

---

## 1. Scope table

| Brief ID | Branch name | Depends on | Conflicts with | Migration file |
|----------|-------------|------------|----------------|----------------|
| **U6** | `feat/u6-onboarding` | Wave 8 `main`; **E1** tokens (UI); existing `setup-wizard` / `onboarding.tsx` (refactor or redirect) | **U7** if both change `Layout` / global nav; **8b** if eslint agent edits same new pages before U6 merges | `migrations/031_org_onboarding.sql` |
| **U7** | `feat/u7-pos-tablet` | **U5** axe on `main` (regression guard); **E1** / partial **E2** (`liquid-metal` POS classes) | **U6** dashboard banner + routes; **8b** mass `client/**` lint if parallel without file ownership | — |
| **8b** (U5 eslint) | `chore/u5-eslint-a11y` | **U5** axe merged; `.eslintrc.cjs` on `main` (minimal today) | **U6** `client/pages/onboarding/**`; **U7** `pos.tsx` + new `pos/components/**` | — |
| **029** / **F6** | — | **F6** already on `main` (`useBarcodeScanner`, `/api/products/by-barcode`) | — | **Skip** — `products.barcode` in `shared/schema.ts`; no `029_*.sql` unless `migration:sanity` fails on prod |
| **P10b** (ops) | — (operator) | **P10b** code on `main`; VPS rebuild with `VITE_PLAUSIBLE_DOMAIN` | — | — |
| **E2** (full shell) | `feat/e2-liquid-metal-shell` (optional) | **E1** | **U7** (same surfaces) | — |
| **E3** | — | Done Wave 6 | — | — |
| **O1–O3** | — (operator) | **H3** metrics on `main` for optional O1 threshold alert | — | — |

---

## 2. Recommended parallel agents (2–3)

### Agent 1 — Onboarding (U6 + 031)

**Owns:** `migrations/031_org_onboarding.sql`, `shared/schema.ts`, `server/routes/onboarding.ts`, `client/src/pages/onboarding/**` (wizard steps), `client/src/pages/dashboard.tsx` (completion banner), `client/src/contexts/OrgContext.tsx`, `server/routes` org-creation redirect, `scripts/apply-migrations-pm2.sh` (append `031`), Vitest/Playwright happy path.

**Do not touch:** `client/src/pages/pos.tsx`, `.eslintrc.cjs`, bulk unrelated `client/**` lint.

**Note:** Today `onboarding.tsx` only creates an org then sends users to `setup-wizard`. U6 replaces/extends that with server-backed `onboarding_state` and five steps ending in a test sale — coordinate with `shared/setup.ts` / `setup-wizard.tsx` to avoid duplicate flows.

### Agent 2 — Tablet POS (U7)

**Owns:** `client/src/pages/pos.tsx`, `client/src/pages/pos/components/{ProductGrid,CartPanel,ActionDrawer}.tsx` (extract per brief), `client/src/index.css` (touch targets), `tests/visual/pos-tablet.spec.ts` (1194×834).

**Do not touch:** `migrations/`, `server/` (unless a tiny API tweak is unavoidable), onboarding routes, eslint config.

**E2 partial:** Apply Liquid Metal / 44px touch targets inside POS only; do **not** expand full **E2** shell brief in this PR.

### Agent 3 — Wave 8b (U5 eslint) — optional third slot

**Owns:** `package.json` (`eslint-plugin-jsx-a11y`), `.eslintrc.cjs`, `client/**` lint fixes, `npm run lint` script, `docs/ACCESSIBILITY.md` (close Wave 8b follow-up).

**Do not touch:** `pos.tsx` / `pos/components/**` until **Agent 2** merges (or exclude POS paths in eslint PR and let U7 own a11y on POS).

**Can run in parallel with Agent 1** if Agent 3 avoids `onboarding/**` until U6 merges.

---

## 3. Merge order

```
1. feat/u6-onboarding     → 031 on Neon + apply-migrations script
2. chore/u5-eslint-a11y   → Wave 8b (before U7 if Agent 3 ran parallel with U6)
3. feat/u7-pos-tablet     → layout + visual snapshot (re-run test:a11y after merge)
```

**Rationale:** Ship **031** first for VPS and org lifecycle; **eslint** before **U7** reduces double-conflict on `pos.tsx`; **U7** last so tablet layout is not churned by jsx-a11y autofixes.

If only **two** agents: run **U6** + **U7** in parallel with strict ownership above; do **8b** as a **solo pre-wave or post-U6** PR (see §5).

---

## 4. Exit criteria / smoke tests per agent

### Agent 1 — U6

| Check | Command / action |
|-------|------------------|
| Migration idempotent | `npm run migration:sanity` after applying `031` locally |
| New org → wizard | SUPER_ADMIN creates org → lands step 1; refresh resumes |
| Dashboard banner | Incomplete onboarding shows “Resume”; hidden when all steps done |
| Server truth | `PATCH /api/onboarding/step` idempotent; not localStorage-only |
| CI | `npm run check && npm run build && npm test` |
| PR title | `feat(onboarding): new-org wizard + dashboard completion banner` |

### Agent 2 — U7

| Check | Command / action |
|-------|------------------|
| Viewport layout | Playwright `tests/visual/pos-tablet.spec.ts` at **1194×834** green |
| Touch targets | axe / manual: ≥44×44 on pay, grid, drawer |
| Desktop regression | 1440×900 pay flow unchanged |
| A11y regression | `npm run test:a11y` after merge |
| CI | `npm run check && npm run build && npm test` |
| PR title | `feat(pos): tablet-optimised landscape layout (iPad Pro)` |

### Agent 3 — 8b (U5 eslint)

| Check | Command / action |
|-------|------------------|
| Lint config | `eslint-plugin-jsx-a11y` **recommended** in `.eslintrc.cjs` |
| Clean lint | `npm run lint` green on `client/` (scope per ownership) |
| No axe regression | `npm run test:a11y` still green |
| Docs | `docs/ACCESSIBILITY.md` Wave 8b section removed or marked done |
| PR title | `chore(a11y): jsx-a11y ESLint pass (U5 follow-up)` |

---

## 5. Wave 8b (U5 eslint) — separate wave or fold into Wave 9?

**Recommendation: separate PR, still in the Wave 9 queue — merge after U6, before U7.**

| Approach | When |
|----------|------|
| **Separate PR (preferred)** | One agent, &lt;600 lines if scoped: config + high-traffic pages first; exclude `pos/**` until U7 lands |
| **Fold into Wave 9 Agent 3** | Same sprint as U6/U7 if you have 3 agents and file boundaries in §2 |
| **Defer to Wave 10** | Only if U7 is urgent on hardware — axe CI already guards critical paths |

Wave 8 delivered **axe in CI**; **8b** is the remaining U5 DoD item (`npm run lint` + jsx-a11y). `.eslintrc.cjs` exists on `main` but does not yet enable jsx-a11y.

---

## 6. Ops O1–O3 — operator checklist (not agent work)

Complete these on the VPS / external tools; no app PR required unless docs gaps are found.

### O1 — External uptime monitoring

1. Create account (UptimeRobot, Better Stack, or similar).
2. Add HTTP monitor: `GET https://viger.cloud/midnight/api/health` every **1–5 min**; alert on non-200 or timeout.
3. Optional: `GET https://viger.cloud/midnight/` (expect HTML 200).
4. Optional (after familiar with metrics): `GET .../api/health/metrics` — alert if `outboxPending` above your threshold (see H3).
5. Send a **test alert**; confirm who is paged; link runbook: [`docs/ops/INCIDENT_CHECKLIST.md`](../ops/INCIDENT_CHECKLIST.md).
6. Optional doc PR later: `docs/ops/UPTIME_MONITORING.md` (brief **O1**).

### O2 — M4 restore drill

1. On VPS: confirm latest backup (`scripts/backup-neon-to-r2.sh` or cron).
2. Restore to a **non-production** database name with `scripts/restore-from-r2.sh`.
3. Against restored DB: `npm run migration:sanity`.
4. Record date, steps, duration, and result in [`docs/DISASTER_RECOVERY.md`](../DISASTER_RECOVERY.md) (sign-off ≤90 days).

### O3 — PM2 survive reboot

1. As deploy user: `pm2 startup` → run the printed **systemd** command with sudo.
2. Confirm `pmnight-epos` online: `pm2 list`.
3. `pm2 save`.
4. Optional maintenance window: reboot VPS → within **2 min** app listens on app port without manual `pm2 start`.

### P10b — Plausible dashboards (ops, code already on `main`)

1. Set `VITE_PLAUSIBLE_DOMAIN` in VPS `.env` before `npm run build` (see [`docs/ANALYTICS.md`](../ANALYTICS.md)).
2. In Plausible UI: add **goals** for coarse events only (`pos_open`, `report_export` if instrumented later).
3. Build **dashboards** (funnels/top pages) — no repo change unless documenting operator steps in `ANALYTICS.md`.

---

## 7. Deferred to Wave 10

| Area | Items |
|------|--------|
| **F long-tail** | Barcode **label printing** (F6 out of scope); bulk legacy gift-card import; manager-PIN refunds &gt;90d; mid-shift cash drops (F2b) |
| **F7 / A** | Channel attribution + analytics depth already on `main` — only enhancements if product asks |
| **E** | Full **E2** token rollout beyond POS touch-ups in U7 |
| **U** | Screen-reader parity walkthrough (manual); WCAG AAA; i18n/RTL (**L5**) |
| **P10** | **P10c** Renovate (done); any Playwright expansion beyond smoke + a11y + tablet snapshot |
| **L1–L7** | WhatsApp, RLS, AI, storefront, etc. — brief when prioritised ([`MASTER_EXECUTION_PLAN.md`](./MASTER_EXECUTION_PLAN.md) §6) |
| **O4** | Done on `main` — incident checklist |

---

## 8. VPS deploy note (when 031 / U6 lands)

After **U6** merges (and `scripts/apply-migrations-pm2.sh` lists `031`):

```bash
cd /root/ARCARNA
git pull origin main
source .env
# If using Plausible: ensure VITE_PLAUSIBLE_DOMAIN is set before build
npm ci && npm run build
bash scripts/apply-migrations-pm2.sh
# adds migrations/031_org_onboarding.sql — update script in U6 PR if missing
pm2 restart arcarna-epos --update-env
```

**Try in app:**

- **New org (SUPER_ADMIN)** → `/midnight/onboarding` wizard; dashboard banner until complete
- **POS (after U7)** → iPad Pro 11" landscape: grid + cart + bottom drawer without page scroll; `npm run test:a11y`
- **Analytics (ops)** → Plausible dashboard shows page views when domain env set

**029:** No deploy action — barcode column already live; F6 shipped Wave 5.

---

## 9. Backlog mapping (user paste)

| User item | Wave 9 disposition |
|-----------|------------------|
| U6 + 031 | **Agent 1** — primary |
| U7 tablet POS | **Agent 2** — primary |
| 029 barcode if needed | **Skip** — F6 + schema done |
| Wave 8b U5 eslint | **Agent 3** or pre-U7 solo PR (§5) |
| P10b Plausible dashboards | **Operator** (§6) — code on `main` |
| E2–E3 partial, U7 main POS layout | **U7** for layout; **E3** done; full **E2** → Wave 10 |
| F long-tail | Wave 10 (§7) |
| O1 O2 O3 open | **Operator** checklist (§6) |

---

## 10. Wave 8 exit criteria (reference — on `main`)

- **P10d:** `playwright.config.ts`, `tests/e2e/smoke.spec.ts`, CI e2e job, `npm run test:e2e`
- **P10b:** `initProductAnalytics()` when `VITE_PLAUSIBLE_DOMAIN` set; `docs/ANALYTICS.md`
- **U5 (axe):** `tests/a11y/critical-paths.spec.ts`, `npm run test:a11y`, zero serious/critical on POS, customers, products, orders, settings

See [`WAVE8_NEXT.md`](./WAVE8_NEXT.md).
