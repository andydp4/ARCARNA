# Phase O — Operations & resilience

Closes **M4 drill**, **S8 external alerts**, and VPS hygiene. Mostly config + docs; minimal app code.

---

## Brief O1 — External uptime monitoring

**Goal:** Get alerted within minutes if production `/midnight/` or health endpoints fail.

**Touch:**

- `~ docs/DEPLOY_HOSTINGER_VPS.md` — monitor URLs, expected status, alert contacts
- `+ docs/ops/UPTIME_MONITORING.md` — provider setup (UptimeRobot / Better Stack / etc.)

**Steps:**

1. Monitor `GET https://viger.cloud/midnight/api/health` every 1–5 min; alert on non-200 or timeout.
2. Optional second check: `GET https://viger.cloud/midnight/` (200 HTML).
3. Optional: JSON check on `/midnight/api/health/metrics` — alert if `outboxPending` &gt; threshold (after H3).
4. Document escalation: who gets paged, link to O4 checklist.

**Out of scope:** In-app alerting worker.

**DoD:** Monitor live; one test alert fired and acknowledged.

**PR title:** `docs(ops): external uptime monitoring runbook (O1)`

---

## Brief O2 — M4 restore drill

**Goal:** Prove Neon→R2 backup restore works; sign off in disaster recovery doc.

**Touch:**

- `~ docs/DISASTER_RECOVERY.md` — drill date, steps taken, result, time-to-restore

**Steps:**

1. On VPS: run latest `scripts/backup-neon-to-r2.sh` (or confirm cron).
2. Restore to a **non-production** DB name using `scripts/restore-from-r2.sh`.
3. Run `npm run migration:sanity` against restored DB.
4. Record outcome in DISASTER_RECOVERY.md.

**Out of scope:** Automating drill in CI.

**DoD:** DR doc has signed drill entry ≤ 90 days old.

**PR title:** `docs(ops): M4 backup restore drill sign-off (O2)`

---

## Brief O3 — PM2 survive reboot

**Goal:** App restarts automatically after VPS reboot.

**Touch:**

- `~ docs/DEPLOY_HOSTINGER_VPS.md` — `pm2 startup` + `pm2 save` section

**Steps:**

1. On VPS as deploy user: `pm2 startup` (follow printed systemd command).
2. `pm2 save` after confirming `midnight-epos` online.
3. Optional: reboot test in maintenance window.

**DoD:** Reboot → app listening on :5000 within 2 min without manual `pm2 start`.

**PR title:** `docs(ops): pm2 startup persistence (O3)`

---

## Brief O4 — Incident response checklist

**Goal:** One-page runbook for “site down” / “API 502” / “auth loop”.

**Touch:**

- `+ docs/ops/INCIDENT_CHECKLIST.md`

**Steps:**

1. Triage: `curl` health, `pm2 logs`, nginx error log, Neon status.
2. Common fixes: rebuild, `pm2 restart`, clear SW cache note for users, base path `.env` check.
3. Post-incident: audit log review, optional Sentry link.

**DoD:** Linked from DEPLOY doc and SECURITY_REVIEW.

**PR title:** `docs(ops): incident response checklist (O4)`
