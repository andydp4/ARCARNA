# Wave 1 — Next 3 agents (ready to launch)

**Prerequisite:** Wave 0 merged on `main` (H1–H4, O4, E1).

**Merge order used:** docs (H2/H4/O4) → H1+H3 → E1.

---

## Agent assignments

| Agent | Branch | Brief | Owns |
|-------|--------|-------|------|
| **1** | `feat/f1-email-receipts` | **F1** | `server/workers/receiptEmailWorker.ts`, `server/routes/receipts.ts`, settings/receipts UI, migration `022_*` |
| **2** | `feat/a1-daily-kpi` | **A1** | `PHASE_A_ANALYTICS.md` Brief A1 — dashboard KPI card, analytics route |
| **3** | `feat/p10a-sentry-fe` | **P10a** | `client/src/lib/sentry.ts`, `main.tsx`, `.env.production.example` |

**Do not parallelize** with each other on `package.json` — merge **P10a first** if lockfile conflicts, or serialize lockfile to one agent.

**Operator (not an agent):** **O1** — point uptime monitor at `https://viger.cloud/midnight/api/health` after deploy.

---

## VPS after deploy

1. `git pull` on VPS → `npm ci && npm run build` → `pm2 restart arcarna-epos`
2. Apply migration: `psql "$DATABASE_URL" -f migrations/014_admin_audit_retention.sql`
3. Run **O2** restore drill when convenient; **O3** `pm2 startup` if not done

---

## Wave 1 exit criteria

- F1: email receipt sends on order (Resend), settings UI
- A1: daily KPI visible on dashboard/home
- P10a: FE errors in Sentry when DSN set
- Deployed to production

---

## Wave 2 (after Wave 1)

```
F2 → F3   (shifts then refunds — sequential, one agent)
U1        (skeletons — after E1 on main)
F7 or A2  (parallel second agent)
```

See [`MASTER_EXECUTION_PLAN.md`](./MASTER_EXECUTION_PLAN.md) §4.
