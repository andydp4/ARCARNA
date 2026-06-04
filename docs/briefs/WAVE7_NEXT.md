# Wave 7 — Next work

**Prerequisite:** Wave 6 on `main` (E3 PWA install, F7 channel attribution, A4 stock turn).

---

## Recommended agents (3 parallel)

| Agent | Branch | Brief | Notes |
|-------|--------|-------|--------|
| **1** | `feat/a5-promotion-lift` | **A5** | Promo lift report — analytics route + promotions lift page; no POS |
| **2** | `feat/p10c-renovate` | **P10c** | `renovate.json` only — zero app code conflict |
| **3** | `feat/p10e-cloudflare-runbook` | **P10e** | `docs/ops/CLOUDFLARE.md` + nginx cross-link — docs only |

**Deferred (Wave 7b or Wave 8):** **P10d** Playwright smoke (blocks **U5** axe CI), **P10b** PostHog/Plausible, **U6** onboarding wizard, **U7** tablet POS.

**Do not parallel:** A5 + promotions CRUD refactors; U5 + U4 list refactors; P10d + large client routing changes on one agent.

---

## VPS after Wave 6 deploy

```bash
cd /root/MidnightEPOS
git pull origin main
source .env
npm ci && npm run build
bash scripts/apply-migrations-pm2.sh
# no new SQL in Wave 6 — script unchanged (028, 030, 032 still apply on fresh DBs)
pm2 restart midnight-epos --update-env
```

**Try in app:**
- **Analytics → Channels** → revenue / orders / AOV by `orders.channel`; totals tie to completed orders
- **Analytics → Stock turn** → category table; slow-mover badge when days of stock > 90
- **Any page** → PWA install banner (Chrome/Android); iOS hint; dismiss hides 7 days
- **Promotions** → (after Wave 7 merge) row links to lift report per promo

---

## Wave 6 exit criteria (on main)

- **E3:** `beforeinstallprompt` banner; iOS “Add to Home Screen” hint; manifest + apple meta; dismiss persists 7d
- **F7:** Channel breakdown (revenue, orders, AOV) for `orders.channel`; 5 min cache; nav link
- **A4:** Stock turn table by category; slow-mover red badge; sortable columns; Vitest on aggregator

---

## Wave 7 exit criteria (branches — merge when reviewed)

- **A5:** Lift % (revenue, AOV, new-customer share) vs baseline window; `/promotions/:id/lift`; Vitest on `promoLift`
- **P10c:** Valid `renovate.json`; patch grouping; README note
- **P10e:** Operator runbook: DNS, SSL, cache rules, API must not cache

---

## Wave 8 preview

```
P10d → Playwright smoke in CI (unblocks U5)
U5   → WCAG AA + axe on critical paths
P10b → PostHog or Plausible (env-gated)
U6   → onboarding wizard
U7   → tablet POS layout
```

See [`MASTER_EXECUTION_PLAN.md`](./MASTER_EXECUTION_PLAN.md) §4.
