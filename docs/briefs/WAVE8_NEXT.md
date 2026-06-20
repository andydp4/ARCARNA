# Wave 8 — Next work

**Prerequisite:** Wave 7 on `main` (A5 promotion lift, P10c Renovate, P10e Cloudflare runbook).

---

## Recommended agents (3 parallel)

| Agent | Branch | Brief | Notes |
|-------|--------|-------|--------|
| **1** | `feat/p10d-playwright` | **P10d** | Playwright smoke + CI job — **unblocks U5** axe tests |
| **2** | `feat/p10b-analytics` | **P10b** | Plausible (env-gated) — `client/src/lib/analytics.ts` only |
| **3** | `feat/u5-a11y` | **U5** | WCAG AA + axe on critical paths — **after P10d merges** or coordinate CI |

**Deferred (Wave 8b or Wave 9):** **U6** onboarding wizard, **U7** tablet POS layout, full **U5** lint (`eslint-plugin-jsx-a11y` — no ESLint config on main yet).

**Do not parallel:** P10d + large client routing refactors; U5 + U4 bulk-action list refactors; P10b + P10d both editing `ci.yml` without coordination.

---

## VPS after Wave 7 deploy

```bash
cd /root/ARCARNA
git pull origin main
source .env
npm ci && npm run build
bash scripts/apply-migrations-pm2.sh
# no new SQL in Wave 7 — script unchanged (028, 030, 032 still apply on fresh DBs)
pm2 restart arcarna-epos --update-env
```

**Try in app:**
- **Promotions** → row “Lift” link → `/promotions/:id/lift` — revenue/AOV/new-customer lift % vs baseline
- **Docs** → `docs/ops/CLOUDFLARE.md` for edge/cache guidance
- **Repo** → Renovate opens grouped dependency PRs per `renovate.json`
- **(After Wave 8 merge)** `npm run test:e2e` locally; CI smoke on PRs

---

## Wave 7 exit criteria (on main)

- **A5:** Lift % (revenue, AOV, new-customer share) vs baseline window; `/promotions/:id/lift`; Vitest on `promoLift`
- **P10c:** Valid `renovate.json`; patch grouping; README note
- **P10e:** Operator runbook: DNS, SSL, cache rules, API must not cache

---

## Wave 8 exit criteria (branches — merge when reviewed)

- **P10d:** `playwright.config.ts`; `tests/e2e/smoke.spec.ts` (health + SPA shell); CI `e2e` job; `npm run test:e2e`
- **P10b:** `initProductAnalytics()` when `VITE_PLAUSIBLE_DOMAIN` set; `docs/ANALYTICS.md`; no-op without env
- **U5:** `tests/a11y/critical-paths.spec.ts`; `docs/ACCESSIBILITY.md`; zero serious/critical axe on POS, customers, products, orders, settings (dev bypass)

---

## Wave 9 preview

```
U6 → onboarding wizard for new orgs
U7 → tablet POS layout (1194×834)
P10b merge + product analytics dashboards
Full U5 eslint jsx-a11y pass (add ESLint config)
```

See [`MASTER_EXECUTION_PLAN.md`](./MASTER_EXECUTION_PLAN.md) §4.
