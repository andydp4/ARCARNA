# Wave 3 — Next work

**Prerequisite:** Wave 2 on `main` (U1, F2, F3).

---

## Recommended agents (3 parallel)

| Agent | Branch | Brief | Notes |
|-------|--------|-------|--------|
| **1** | `feat/u2-command-palette` | **U2** | Cmd-K global palette — no POS/shifts conflict |
| **2** | `feat/f4-gift-cards` | **F4** | Gift cards + store credit (needs F3 on main ✓) |
| **3** | `feat/e2-liquid-metal-shell` | **E2** | Liquid Metal tokens on Layout + POS shell |

**Optional 4th (if capacity):** **F7** channel attribution OR **A2** RFM — analytics only, no POS.

**Do not parallel:** E2 + U7 (both heavy POS); F4 + F5 on same agent (gift cards before loyalty UX polish).

---

## VPS after Wave 2 deploy

```bash
cd /root/ARCARNA
git pull origin main
source .env
npm ci && npm run build
bash scripts/apply-migrations-pm2.sh
# or: psql "$DATABASE_URL" -f migrations/023_shifts.sql
#     psql "$DATABASE_URL" -f migrations/024_orders_shift_id.sql
#     psql "$DATABASE_URL" -f migrations/025_refunds.sql
pm2 restart arcarna-epos --update-env
```

**Try in app:**
- **POS** → open shift (float) before placing orders
- **Shifts** page → Z-report after close
- **Orders** → Issue refund on a line
- List pages → skeletons while loading, empty states when no rows

---

## Wave 3 exit criteria

- **U2:** Cmd/Ctrl-K opens palette; jump to pages/products/customers
- **F4:** Issue/redeem gift card; store-credit refund method
- **E2:** Layout + POS use Liquid Metal tokens (flag off = subtle; E1 tokens applied)

---

## Wave 4 preview

```
F5 → F6   (loyalty UX, barcode scanner)
U3 → U4 → U5
A2 → A3
E3 (PWA)
```

See [`MASTER_EXECUTION_PLAN.md`](./MASTER_EXECUTION_PLAN.md) §4.
