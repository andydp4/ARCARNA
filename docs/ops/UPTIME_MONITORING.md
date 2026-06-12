# External uptime monitoring (O1)

Configure **external** HTTP checks so production failures page someone within minutes. This is operator work on UptimeRobot, Better Stack, Pingdom, or similar — no application code change required.

**Related:** [INCIDENT_CHECKLIST.md](./INCIDENT_CHECKLIST.md) · [DEPLOY_HOSTINGER_VPS.md](../DEPLOY_HOSTINGER_VPS.md) · [SECURITY_REVIEW.md](../SECURITY_REVIEW.md) (metrics thresholds)

---

## Monitors to create

| Monitor | URL | Interval | Alert on |
|---------|-----|----------|----------|
| **Primary health** | `GET https://viger.cloud/midnight/api/health` | 1–5 min | Non-200, timeout (>30s), SSL error |
| **App shell (optional)** | `GET https://viger.cloud/midnight/` | 5 min | Non-200 |
| **Metrics (optional)** | `GET https://viger.cloud/midnight/api/health/metrics` | 5 min | Non-200; JSON field thresholds (see below) |

Expected health body: `{"ok":true,...}`.

**Do not use** `/midnightepos` (no slash) — returns 404 and spams PM2 logs.

---

## Optional metrics thresholds (H3)

After [H3 health metrics](../briefs/PHASE_HARDENING.md#brief-h3--finish-s8-extended-health-metrics) is live, add a **keyword / JSON** check or external script:

| Field | Suggested alert | Meaning |
|-------|-----------------|--------|
| `outboxPending` | > 100 | Outbox backlog growing |
| `oldestPendingSeconds` | > 300 | Stale pending events |
| `deadLetterCount` | increasing day-over-day | Worker failures |
| `jobQueued` | > 500 | Job queue backlog |

Tune thresholds per environment. Public scrape is intentional (no auth) — see [SECURITY_REVIEW.md](../SECURITY_REVIEW.md).

---

## Setup steps (UptimeRobot example)

1. Create account → **Add New Monitor** → type **HTTP(s)**.
2. URL: `https://viger.cloud/midnight/api/health`
3. Monitoring interval: **5 minutes** (or 1 min for critical).
4. Alert contacts: email/SMS/Slack — assign on-call rotation in your team wiki.
5. **Create monitor** → use **Test Alert** to confirm delivery.
6. Repeat for optional monitors above.

Better Stack / Pingdom: same URLs; configure status code 200 and response-time SLA.

---

## Escalation

1. Alert fires → follow [INCIDENT_CHECKLIST.md](./INCIDENT_CHECKLIST.md).
2. If health is 200 but users report issues → SW/cache (checklist §4) or Clerk/auth.
3. Post-incident: note in internal log; review `admin_audit_logs` if access-related.

---

## Verification (DoD)

- [x] Primary health monitor live and green
- [x] Test alert received and acknowledged
- [ ] Escalation contacts documented (team wiki)
- [ ] Optional: metrics monitor with thresholds

**Helper script (from any machine with curl):**

```bash
bash scripts/verify-production-headers.sh
```
