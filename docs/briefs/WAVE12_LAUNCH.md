# Wave 12 — Launch & testing readiness

**Status:** **Deployed + QA signed off** (`main` @ PR **#35** + auth/deploy fixes **#36–#39**, **#37**).

**Prerequisite:** Wave 11 on `main` and live — [`WAVE11_LAUNCH.md`](./WAVE11_LAUNCH.md).

**Next work:** [`WAVE13_NEXT.md`](./WAVE13_NEXT.md)

---

## Wave 12 deliverables

| Item | Status |
|------|--------|
| List-page Liquid Metal (`inventory`, `locations`, `user-access`) | **Done** — PR #35 |
| GAP-E2 list pages closed | **Done** |
| VPS deploy (`392515a`+) | **Done** — `/root/ARCARNA` |
| Live smoke (list pages + auth) | **Done** |
| Auth hardening follow-ups (#36–#37) | **Done** — merged; redeploy `a37e9ae` for #37 |
| Deploy env reload (#38) | **Done** — `deploy:restart` delete+start |
| Sentry request-id (#39) | **Done** |

**Still backlog (Wave 13):**

| Item | Wave / gap |
|------|------------|
| Import modal empty states | GAP-U1-03 |
| `lint:strict` repo-wide | GAP-U5-01 |
| O2 restore drill, O3 PM2 reboot test | [`OPERATOR_CHECKLIST.md`](../ops/OPERATOR_CHECKLIST.md) |

---

## Deploy (VPS)

App path: **`/root/ARCARNA`**.

```bash
cd /root/ARCARNA
git fetch origin && git checkout main && git pull origin main
git log -1 --oneline    # expect a37e9ae or newer

set -a && source .env && set +a
unset NODE_ENV
npm ci --include=dev
npm run build
bash scripts/apply-migrations-pm2.sh
npm run deploy:restart

sleep 5
curl -fsS http://127.0.0.1:5000/midnight/api/health && echo
```

**From laptop:**

```bash
bash scripts/verify-production-headers.sh
curl -fsS https://viger.cloud/midnight/api/health
```

---

## Testing matrix (manual QA)

### List pages (Wave 12)

- [x] `/inventory` — `PageHeader` + LM cards; tabs (Stock, Smart Stock, etc.)
- [x] `/locations` — location switcher below header; add/edit location
- [x] `/user-access` — pending badge; approve/reject flows

### Auth (PRs #31, #36, #37)

- [x] Sign in via Account Portal → dashboard loads (no bounce to landing)
- [x] Sign out → sign in again
- [x] No spurious `CancelledError` after sign-in (#36)
- [ ] After #37 deploy: session stable when Clerk JWT hydrates after redirect

### Production health

- [x] `GET /midnight/api/health` → `{"ok":true,"authProvider":"clerk"}`
- [x] Uptime monitor on `/midnight/api/health` (not `/midnightepos`)

---

## PR ledger (Wave 11–12 + hotfixes)

| PR | Summary |
|----|---------|
| #31 | Wait for Clerk JWT before server session sync |
| #32 | Setup wizard Liquid Metal (Wave 11) |
| #33–#34 | Neon transient retries + pool hardening |
| #35 | List pages Liquid Metal (Wave 12 E2) |
| #36 | `CancelledError` no longer aborts session sync |
| #37 | Token-gated `ClerkSessionSync`; no retry on `createProduct` |
| #38 | `deploy:restart` re-creates PM2 for `.env` reload |
| #39 | Sentry request-id middleware + ops ticks |
