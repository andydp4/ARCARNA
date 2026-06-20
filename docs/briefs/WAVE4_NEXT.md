# Wave 4 — Next work

**Prerequisite:** Wave 3 on `main` (U2, E2, F4).

---

## Recommended agents (3 parallel)

| Agent | Branch | Brief | Notes |
|-------|--------|-------|--------|
| **1** | `feat/a2-rfm-segmentation` | **A2** | RFM analytics — server + new page; no POS/list conflicts |
| **2** | `feat/u3-saved-filter-views` | **U3** | Saved views on customers / products / orders — client + small API |
| **3** | `feat/f5-loyalty-ux` | **F5** | Tier progress + points redemption at POS — touches POS only |

**Optional 4th (if capacity):** **F6** barcode scanner OR **A3** hour-of-day heatmap — pick one, not both with F5 (POS overlap for F6).

**Do not parallel:** F5 + F6 (both POS); U3 + U4 (same list pages); A2 + A3 on one agent (separate analytics pages OK in parallel).

---

## VPS after Wave 3 deploy

```bash
cd /root/ARCARNA
git pull origin main
source .env
npm ci && npm run build
bash scripts/apply-migrations-pm2.sh
# includes 026_gift_cards.sql, 027_gift_card_movements.sql
pm2 restart arcarna-epos --update-env
```

**Try in app:**
- **Cmd/Ctrl-K** → jump to pages, customers, products
- **POS** → Liquid Metal shell styling
- **Gift cards** → issue card; redeem at checkout; store-credit refund method

---

## Wave 4 exit criteria

- **A2:** RFM page shows 6 segments; CSV export; nightly recompute
- **U3:** Save/load named filter views on customers, products, orders
- **F5:** Tier progress badge at POS; redeem points for discount (server-validated)

---

## Wave 5 preview

```
F6 → F7   (barcode scanner, channel attribution)
U4 → U5   (bulk actions, WCAG + axe CI)
A3 → A4 → A5
E3 (PWA install)
```

See [`MASTER_EXECUTION_PLAN.md`](./MASTER_EXECUTION_PLAN.md) §4.
