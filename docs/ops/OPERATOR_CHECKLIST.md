# Operator checklist — Wave 0 closure (O1–O3 + H1 verify)

One-page checklist for **VPS / external tooling** items that cannot be closed by application PRs alone. Run after each major deploy or quarterly.

**After Wave 12:** production at `a37e9ae`+ on VPS1 `/root/ARCARNA` — [`briefs/WAVE12_LAUNCH.md`](../briefs/WAVE12_LAUNCH.md).

**Code status on `main`:** Waves 0–12 shipped (LM list pages #35, auth #31/#36/#37, deploy #38, Sentry context #39). This checklist closes remaining **operator** gaps from [GAPS_BACKLOG.md](../briefs/GAPS_BACKLOG.md).

---

## H1 — Production HSTS verify (GAP-H1-01)

**Goal:** `Strict-Transport-Security` header present on live HTTPS responses.

1. On VPS, confirm nginx HTTPS block includes (see `deploy/nginx-viger.cloud.conf.example`):

   ```nginx
   add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
   ```

2. From any machine:

   ```bash
   bash scripts/verify-production-headers.sh
   # or manually:
   curl -sI https://viger.cloud/arcarna/api/health | grep -i strict-transport-security
   ```

3. Expected: `Strict-Transport-Security: max-age=31536000; includeSubDomains`

- [ ] HSTS header verified on production
- [ ] Date verified: ___________

**CSP (GAP-H1-02):** Accepted risk — Node CSP off for Clerk+Vite. Documented in [SECURITY_REVIEW.md](../SECURITY_REVIEW.md) § Content-Security-Policy. No VPS action unless tightening nginx-only CSP later.

---

## O1 — External uptime monitoring

Follow [UPTIME_MONITORING.md](./UPTIME_MONITORING.md).

- [x] Health monitor live (`/arcarna/api/health`) — 2026-06-11
- [x] Test alert fired and acknowledged
- [ ] On-call contacts linked from incident checklist
- [ ] Remove stray monitor polling `/midnightepos` (404 every minute in PM2 logs)

---

## O2 — M4 restore drill (GAP-O2-01)

Follow [DISASTER_RECOVERY.md](../DISASTER_RECOVERY.md) § Restore drill.

1. Confirm nightly backup cron (`scripts/cron.example`).
2. Restore to **non-production** DB: `./scripts/restore-from-r2.sh latest`
3. `npm run migration:sanity` against restored DB.
4. Record row-count spot check (orders, products, customers).
5. Fill drill log table in `DISASTER_RECOVERY.md`.

- [ ] Drill completed
- [ ] Drill log row added with date and operator

---

## O3 — PM2 survive reboot (GAP-O3-01)

On VPS as deploy user:

```bash
pm2 list                    # arcarna-epos online
pm2 startup                 # run printed sudo systemd command once
pm2 save
```

Optional maintenance window:

```bash
sudo reboot
# within 2 min after boot:
curl -fsS http://127.0.0.1:5000/arcarna/api/health
pm2 list
```

- [ ] `pm2 startup` systemd unit installed
- [ ] `pm2 save` run after last deploy
- [ ] Optional reboot test passed

See [DEPLOY_HOSTINGER_VPS.md](../DEPLOY_HOSTINGER_VPS.md) §5 PM2.

---

## P10b — Plausible dashboards (GAP-P10B-01)

Code is on `main`. Operator steps:

1. Set `VITE_PLAUSIBLE_DOMAIN=viger.cloud` in VPS `.env` **before** `npm run build`.
2. Rebuild and restart: `npm run deploy:build && npm run deploy:restart`.
3. In Plausible UI: add site, configure goals per [ANALYTICS.md](../ANALYTICS.md).

- [ ] Domain env set and rebuild done
- [ ] Plausible receiving page views

---

## Sign-off

| Item | Owner | Date | Notes |
|------|-------|------|-------|
| H1 HSTS | | | |
| O1 uptime | | | |
| O2 restore drill | | | |
| O3 PM2 reboot | | | |
| P10b Plausible | | | |

When all rows are filled, Wave 0 ops ledger is closed for production.
