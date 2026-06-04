# Wave 5 — Next work

**Prerequisite:** Wave 4 on `main` (U3 saved views, A2 RFM, F5 loyalty UX).

---

## Recommended agents (3 parallel)

| Agent | Branch | Brief | Notes |
|-------|--------|-------|--------|
| **1** | `feat/a3-hour-of-day-heatmap` | **A3** | Hour-of-day analytics page — server + chart; no POS/list conflicts |
| **2** | `feat/u4-bulk-actions` | **U4** | Multi-select bulk actions on customers / products / orders |
| **3** | `feat/f6-barcode-scanner` | **F6** | USB keyboard-wedge scanner on POS — builds on F5 loyalty UI |

**Deferred (Wave 5b or parallel if capacity):** **F7** channel attribution, **U5** WCAG + axe CI, **E3** PWA install, **A4** stock turn.

**Do not parallel:** F6 + F7 (both analytics/POS adjacent); U4 + U5 (same list surfaces); A3 + A4 on one agent (separate pages OK in parallel).

---

## VPS after Wave 4 deploy

```bash
cd /root/MidnightEPOS
git pull origin main
source .env
npm ci && npm run build
bash scripts/apply-migrations-pm2.sh
# includes 028_loyalty_settings.sql, 030_saved_views.sql, 032_customer_rfm.sql
pm2 restart midnight-epos --update-env
```

**Try in app:**
- **Customers / Products / Orders** → saved filter views (View selector)
- **Analytics → RFM Segments** → segment cards + CSV export
- **POS** → tier progress badge; redeem loyalty points at checkout

---

## Wave 5 exit criteria

- **A3:** 7×24 heatmap page; tooltip matches bucket totals; 5 min cache
- **U4:** Bulk select + action bar on customers, products, orders; typed confirm for delete; role-gated
- **F6:** Scanner burst adds product; ignored when focus in input; success/fail beep

---

## Wave 6 preview

```
F7 → channel attribution dashboard
U5 → WCAG AA + axe in CI (needs P10d Playwright)
A4 → A5   (stock turn, promotion lift)
E3 → PWA install experience
P10b–e    (PostHog, Renovate, Cloudflare runbook)
```

See [`MASTER_EXECUTION_PLAN.md`](./MASTER_EXECUTION_PLAN.md) §4.
