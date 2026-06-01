# Wave 2 — Next work

**Prerequisite:** Wave 1 on `main` (P10a, A1, F1).

---

## Recommended agents (2 parallel max)

| Agent | Branch | Brief | Notes |
|-------|--------|-------|--------|
| **1** | `feat/f2-shifts-zreport` | **F2** then **F3** | **Sequential in one agent** — shifts before refunds |
| **2** | `feat/u1-skeletons` | **U1** | Skeletons + empty states (Liquid Metal tokens on main) |

Optional parallel (third agent): **F7** channel attribution after A1 on main.

---

## VPS after Wave 1 deploy

```bash
cd /root/MidnightEPOS && git pull origin main
source .env
npm ci && npm run build
psql "$DATABASE_URL" -f migrations/022_receipt_settings.sql
pm2 restart midnight-epos --update-env
```

**F1 env (optional):** `RESEND_API_KEY`, `RECEIPT_FROM_EMAIL`, `RECEIPT_SIGNING_SECRET`  
**P10a env (rebuild required):** `VITE_SENTRY_DSN`

---

## Wave 1 merged commits

- P10a — Sentry FE
- A1 — Daily KPI on home dashboard
- F1 — Email receipts
