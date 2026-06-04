# Wave 6 — Next work

**Prerequisite:** Wave 5 on `main` (A3 hour-of-day, U4 bulk actions, F6 barcode scanner).

---

## Recommended agents (3 parallel)

| Agent | Branch | Brief | Notes |
|-------|--------|-------|--------|
| **1** | `feat/e3-pwa-install` | **E3** | Install prompt + manifest/meta polish; touches Layout only |
| **2** | `feat/f7-channel-attribution` | **F7** | Channel revenue dashboard — server + analytics page; no POS |
| **3** | `feat/a4-stock-turn` | **A4** | Stock turn by category — separate analytics page from F7/A3 |

**Deferred (Wave 6b or parallel if capacity):** **A5** promotion lift, **U5** WCAG + axe CI (needs **P10d**), **P10b–e** platform polish.

**Do not parallel:** F7 + POS changes; U5 + U4 list refactors; A4 + A5 on one agent (separate pages OK in parallel).

---

## VPS after Wave 5 deploy

```bash
cd /root/MidnightEPOS
git pull origin main
source .env
npm ci && npm run build
bash scripts/apply-migrations-pm2.sh
# no new SQL in Wave 5 — script unchanged (028, 030, 032 still apply on fresh DBs)
pm2 restart midnight-epos --update-env
```

**Try in app:**
- **Analytics → Hour of day** → 7×24 heatmap; tooltip totals match buckets
- **Customers / Products / Orders** → multi-select + bulk action bar; typed confirm on delete
- **POS** → USB scanner adds line; ignored when focus in input; success/fail beep

---

## Wave 6 exit criteria

- **E3:** `beforeinstallprompt` banner; iOS “Add to Home Screen” hint; manifest + apple meta; dismiss persists 7d
- **F7:** Channel breakdown (revenue, orders, AOV) for `orders.channel`; 5 min cache; nav link
- **A4:** Stock turn table by category; slow-mover red badge; sortable columns; Vitest on aggregator

---

## Wave 7 preview

```
A5 → promotion lift per promo
U5 → WCAG AA + axe in CI (after P10d)
P10b → PostHog; P10c Renovate; P10e Cloudflare runbook
U6 → onboarding wizard; U7 tablet POS
```

See [`MASTER_EXECUTION_PLAN.md`](./MASTER_EXECUTION_PLAN.md) §4.
