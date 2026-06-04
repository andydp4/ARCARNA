# Wave 10 — Launch & preflight

**Status:** In progress on `main` (Wave 10 sweep started).

**Prerequisite:** Wave 9 complete (U6 onboarding, U5 eslint, U7 tablet POS, auth satellite fix, Liquid Metal front pages).

---

## Wave 10 deliverables (this sweep)

| Item | Status |
|------|--------|
| Dedicated `/sign-out` page (offline wipe + Clerk session end) | Done |
| Liquid Metal on auth/status pages (pending, no-access, setup-blocked, 404) | Done |
| Home dashboard quick actions → `lm-card` / QuickActionCard | Done |
| Onboarding pages → `lm-auth-shell` | Done |
| `npm run wave10:preflight` script | Done |
| `scripts/verify-workers.ts` (REQUIRED_WORKERS registry) | Done |
| GAP-E2-01 remainder (settings, all list chrome) | Done — settings + reports (`PageHeader`, `LM_CARD`) |
| GAP-U1 empty states | Done — orders, invoices, reports zero-data |
| `lint:strict` green | Backlog |
| O1–O3 ops (HSTS verify, backups cron) | Operator |

---

## Preflight (local or VPS)

```bash
cd /root/MidnightEPOS   # or dev clone
git pull origin main

# Full check (needs DATABASE_URL in .env for migration sanity)
npm run wave10:preflight

# Build & deploy
unset NODE_ENV
npm ci --include=dev
npm run build
set -a && source .env && set +a
bash scripts/apply-migrations-pm2.sh
pm2 restart midnight-epos --update-env
```

---

## Smoke checklist

- [ ] https://viger.cloud/ — portal Liquid Metal + logo
- [ ] https://viger.cloud/midnight/ — landing logo + sign-in
- [ ] Sign in → dashboard (Clerk Bearer + satellite)
- [ ] Sign out (header) → `/midnight/sign-out` → “Signed out” → sign in again
- [ ] POS landscape on tablet (U7)
- [ ] New org → `/onboarding/wizard`
- [ ] `GET /midnight/api/health` → `{"ok":true}`
- [ ] PM2 logs: `[WorkerRunner] Registered 9 workers`
- [ ] `npm run migration:sanity` → PASSED

---

## Security notes

- Run `npm audit` — review high/critical; many are transitive dev tooling.
- HSTS: verify on live nginx (`GAP-H1-01`).
- CSP: intentionally off in Node for Clerk+Vite (`GAP-H1-02` documented).
- Never set `DEV_AUTH_BYPASS=1` in production.

---

## Next agents (optional)

See [`GAPS_BACKLOG.md`](./GAPS_BACKLOG.md): `lint:strict`, U1 empty states, E2 settings/reports polish.
