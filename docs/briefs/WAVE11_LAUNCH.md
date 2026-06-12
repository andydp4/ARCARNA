# Wave 11 — Launch & testing readiness

**Status:** **Complete** — deployed + QA signed off. See [`WAVE12_LAUNCH.md`](./WAVE12_LAUNCH.md) for current production state.

**Prerequisite:** Wave 10 on `main` (Clerk #30–#31, PWA SW, WhatsApp 033–035, logo, ops docs).

**Agent brief:** [`WAVE11_NEXT.md`](./WAVE11_NEXT.md) · **Wave 10 tracker:** [`WAVE10_LAUNCH.md`](./WAVE10_LAUNCH.md)

---

## Wave 11 deliverables

| Item | Status |
|------|--------|
| Setup wizard Liquid Metal shell (`setup-wizard.tsx`) | **Done** — PR #32 |
| GAP-E2-02 closed | **Done** |
| `npm run wave10:preflight` green (local) | **Done** |
| VPS deploy (`654ae9d`+) | **Done** |
| Live smoke (§ Testing matrix) | **Done** |

**Still backlog (non-blocking for QA):**

| Item | Wave / gap |
|------|------------|
| `lint:strict` repo-wide | Wave 11 Agent 3 — GAP-U5-01 |
| Import modal empty states | Wave 11 Agent 2 — GAP-U1-03 |
| List pages `bg-background` (inventory, reports, locations, user-access) | Wave 12+ |
| O1–O3 ops sign-off | [`OPERATOR_CHECKLIST.md`](../ops/OPERATOR_CHECKLIST.md) |

---

## Preflight (dev clone — before deploy)

```bash
cd MidnightEPOS
git pull origin main
npm ci --include=dev
npm run wave10:preflight    # needs DATABASE_URL in .env for migration sanity
npm run build
```

**CI on `main` must be green:** TypeScript, migration sanity, release gate, Playwright smoke + a11y.

---

## Deploy (VPS)

SSH to production (see Hostinger: **Live.Viger.Cloud** or app path in [`DEPLOY_HOSTINGER_VPS.md`](../DEPLOY_HOSTINGER_VPS.md)).

```bash
cd /var/www/midnight-epos   # or /root/MidnightEPOS
git fetch origin && git checkout main && git pull origin main
git log -1 --oneline        # expect 654ae9d or newer

set -a && source .env && set +a
unset NODE_ENV
npm ci --include=dev
npm run build
bash scripts/apply-migrations-pm2.sh   # includes 031, 033–035 if not yet applied
npm run deploy:restart
# or: npm run deploy
```

**Verify on box:**

```bash
curl -fsS http://127.0.0.1:5000/midnight/api/health
pm2 logs midnight-epos --lines 20 --nostream | grep -i worker
```

**From laptop:**

```bash
bash scripts/verify-production-headers.sh
curl -fsS https://viger.cloud/midnight/api/health
```

---

## Testing matrix (manual QA)

Use this after deploy. Full retail flows: [`LAUNCH_CHECKLIST.md`](../LAUNCH_CHECKLIST.md).

### Auth & onboarding (priority — Wave 11 touch)

- [ ] `https://viger.cloud/midnight/` — sign-in, Clerk satellite
- [ ] Sign out → `/midnight/sign-out` → sign in again
- [ ] New org (SUPER_ADMIN) → `/onboarding/wizard` — Liquid Metal shell
- [ ] **Setup wizard** (`/setup-wizard`) — **Liquid Metal** background + `lm-card` (not white `bg-background`)
- [ ] Complete setup wizard → dashboard loads
- [ ] PWA: hard refresh once after deploy (new `sw.js` cache v4 on main)

### Core retail smoke

- [ ] Create product + customer
- [ ] POS order completes (tablet landscape if available)
- [ ] Invoice/PDF generates
- [ ] Inventory → Smart Stock loads
- [ ] Settings → WhatsApp panel loads (if configured)

### API & workers

- [ ] `GET /midnight/api/health` → `{"ok":true}`
- [ ] PM2: `[WorkerRunner] Registered 9 workers`

### Security / ops (non-blocking but track)

- [ ] `DEV_AUTH_BYPASS` unset or `0` in production `.env`
- [ ] HSTS on live — [`OPERATOR_CHECKLIST.md`](../ops/OPERATOR_CHECKLIST.md) GAP-H1-01
- [ ] External uptime monitor — GAP-O1-01
- [ ] `pm2 startup` + `pm2 save` — GAP-O3-01

---

## Automated tests (local or CI)

```bash
npm run check
npm run test
npm run test:e2e      # smoke
npm run test:a11y     # axe critical paths
npm run release:preflight   # with DATABASE_URL
```

---

## Known open gaps (do not block Wave 11 QA)

Documented in [`GAPS_BACKLOG.md`](./GAPS_BACKLOG.md):

- GAP-U1-03 — import modals
- GAP-U4-01–04 — bulk actions polish
- GAP-U5-01 — `lint:strict` full pass
- GAP-U5-02–03 — manual keyboard POS walkthrough, reduced motion audit
- GAP-P10B-01 — Plausible dashboards (operator)
- GAP-F6-01–02 — barcode label print, migration 029 only if prod lacks column
- GAP-O1/O2/O3 — operator VPS tasks

---

## Next agents

See [`WAVE11_NEXT.md`](./WAVE11_NEXT.md) §3–4 (import empty states, lint:strict) or Wave 12 E2 list-page shell.
