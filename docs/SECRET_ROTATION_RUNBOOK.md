# Secret rotation runbook

Operators use this runbook when rotating credentials for MidnightEPOS on **https://viger.cloud/midnight** (PM2 + Neon + Clerk). Pair with [SECURITY_REVIEW.md](./SECURITY_REVIEW.md) and [DEPLOY_HOSTINGER_VPS.md](./DEPLOY_HOSTINGER_VPS.md).

## Roles and cadence

| Role | Responsibility |
|------|----------------|
| **Platform owner** | Approves rotation window; updates Clerk dashboard; verifies sign-in after Clerk rotate |
| **VPS operator** | Edits `/root/ARCARNA/.env`, runs `npm run deploy:build` + `npm run deploy:restart`, confirms health |
| **DB admin** | Rotates Neon password; updates `DATABASE_URL`; confirms `migration:sanity` |

| Secret | Recommended cadence | Trigger for immediate rotate |
|--------|---------------------|------------------------------|
| Clerk `CLERK_SECRET_KEY` / publishable keys | Annually or on staff change | Key leaked, former admin, Clerk incident |
| `DATABASE_URL` (Neon) | Annually | Credential in chat, git, or public log |
| `SESSION_SECRET` | Annually | Suspected session forgery or leak |
| R2 `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Annually | Backup bucket compromise |
| `BACKUP_NOTIFY_WEBHOOK` | On provider change | Webhook URL leaked |
| Channel webhook HMAC `secret` (per org) | On compromise | Partner reports forged callbacks |
| API keys (`mk_live_…`) | Per key on compromise | Revoke via **API keys** UI / `POST /api/api-keys/:id/revoke` |
| `RESEND_API_KEY` (when enabled) | Annually | Email abuse or provider notice |

## Pre-rotation checklist

1. Schedule a **5–15 minute** maintenance window (users can stay signed in; plan for one forced re-login after `SESSION_SECRET` rotate).
2. Confirm current health: `curl -fsS https://viger.cloud/midnight/api/health`.
3. Note current PM2 uptime: `pm2 status arcarna-epos`.
4. Ensure you can edit `.env` on the VPS and access Clerk + Neon dashboards.
5. **Do not** paste new secrets into chat, tickets, or git — only into `.env` on the server.

## Rotation procedures

### Clerk (`CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`)

1. In [Clerk Dashboard](https://dashboard.clerk.com) → API Keys, create or roll keys per Clerk’s guidance.
2. On the VPS, update `.env`: `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY` (all three must match the same Clerk instance).
3. Rebuild frontend (keys are baked at build time): `npm run deploy:build`.
4. `npm run deploy:restart`.
5. **Verify:** Open `/midnight/sign-in`, complete login, open a tenant page. Check browser console for Clerk/CSP errors.
6. **Blast radius:** All users must sign in again if sessions are invalidated; existing Clerk sessions usually survive secret-only rotate — test explicitly.

### Database (`DATABASE_URL`)

1. In Neon → **Reset password** (or create a new role and connection string with least privilege).
2. Update `DATABASE_URL` in `.env` only.
3. `npm run deploy:restart` (no frontend rebuild required).
4. **Verify:** `curl -fsS https://viger.cloud/midnight/api/health` and `npm run migration:sanity` on the VPS.
5. **Blast radius:** App down until URL is correct; no data loss if URL points to same database.

### Session signing (`SESSION_SECRET`)

1. Generate a new random string (32+ characters): `openssl rand -base64 32`.
2. Replace `SESSION_SECRET` in `.env`.
3. `npm run deploy:restart` (rebuild optional).
4. **Verify:** Sign out, sign in again, complete one authenticated API action (e.g. load dashboard).
5. **Blast radius:** All server-side sessions invalidated; users re-authenticate via Clerk.

### Cloudflare R2 backup credentials (`R2_*`)

1. In Cloudflare R2 → manage API token; create new key with write/list on backup bucket only.
2. Update `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` in `.env`.
3. Run a manual backup: `bash scripts/backup-neon-to-r2.sh`.
4. **Verify:** `aws --endpoint-url "$R2_ENDPOINT" s3 ls "s3://$R2_BUCKET/backups/"` shows a new dump.
5. Revoke old R2 key after successful backup.
6. **Blast radius:** Nightly cron fails until updated; production app unaffected.

### Backup notify webhook (`BACKUP_NOTIFY_WEBHOOK`)

1. Rotate URL/secret in Slack (or provider).
2. Update `.env`; optional test by running backup script once.
3. **Blast radius:** Ops notifications only.

### Outbound webhook signing secrets (per org)

Configured in `POST /api/webhooks` (see [CHANNEL_INGEST.md](./CHANNEL_INGEST.md)).

1. In MidnightEPOS, create a new webhook endpoint with a new `secret` (or update per future API).
2. Coordinate with the receiver to accept both secrets during overlap if supported.
3. Disable old endpoint.
4. **Blast radius:** Missed outbound events for that integration until receiver updates.

### Org API keys (`mk_live_…`)

1. **Revoke** compromised key: `POST /api/api-keys/:id/revoke` or super-admin UI.
2. Issue a new key with minimum `scopes`.
3. **Blast radius:** External catalog/ingest using that key fails until partners update.

### Resend (`RESEND_API_KEY`) — when email receipts are enabled

1. Rotate in Resend dashboard.
2. Update `.env`; restart PM2.
3. **Verify:** Send a test receipt in staging or to a test address.
4. **Blast radius:** Receipt email delivery only.

## Post-rotation verification (all rotates)

```bash
curl -fsS https://viger.cloud/midnight/api/health
curl -fsS https://viger.cloud/midnight/api/health/metrics   # if H3 metrics deployed
pm2 logs arcarna-epos --lines 30 --nostream
```

1. Confirm no spike in 5xx in nginx/PM2 logs.
2. If rotation was security-related, review **Audit log** (`/audit-logs`) for the incident window.
3. Record rotation date, operator, and secrets rotated in your internal ops log (not in git).

## Incident linkage

If rotation was triggered by a breach or outage, follow [ops/INCIDENT_CHECKLIST.md](./ops/INCIDENT_CHECKLIST.md) for triage and post-incident steps.

## Related

- [SECURITY_REVIEW.md](./SECURITY_REVIEW.md) — threat model and audit retention
- [PRODUCTION_ENV.md](./PRODUCTION_ENV.md) — variable reference
- [AUTH_SETUP_CLERK.md](./AUTH_SETUP_CLERK.md) — Clerk URLs and MFA
