# Wave 10 — Next work

**Launch tracker:** [`WAVE10_LAUNCH.md`](./WAVE10_LAUNCH.md) · **Preflight:** `npm run wave10:preflight`

**Prerequisite:** Wave 9 on `main` ✓

---

## Operator (no PR)

- **O1–O3** — [`GAPS_BACKLOG.md`](./GAPS_BACKLOG.md) ops section
- **P10b** — Plausible dashboards in UI
- **GAP-H1-01** — verify HSTS on production

---

## Dev agents (suggested)

| Agent | Branch | Brief |
|-------|--------|-------|
| 1 | `chore/lint-strict-pass` | Clear `npm run lint:strict` on non-POS client |
| 2 | `feat/e2-shell-remainder` | [GAP-E2-01](./GAPS_BACKLOG.md#gap-e2-01) |
| 3 | `feat/u1-empty-state-gaps` | [GAP-U1-01](./GAPS_BACKLOG.md#gap-u1-01) |

**Long horizon:** L1–L7, F label printing — [`MASTER_EXECUTION_PLAN.md`](./MASTER_EXECUTION_PLAN.md) §6.

---

## VPS after Wave 9

```bash
cd /root/MidnightEPOS
git pull origin main
source .env
npm ci && npm run build
bash scripts/apply-migrations-pm2.sh   # adds 031
pm2 restart midnight-epos --update-env
```

Smoke: new org → `/onboarding/wizard`; home banner until complete; POS on iPad landscape.
