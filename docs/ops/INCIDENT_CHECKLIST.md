# Incident response checklist

One-page runbook for **site down**, **API 502/503**, and **auth redirect loops** on production (**https://viger.cloud/midnight**).

Escalation contacts and on-call rotation are **team-specific** — fill in names/phones in your internal wiki; link external monitors from [DEPLOY_HOSTINGER_VPS.md](../DEPLOY_HOSTINGER_VPS.md) (O1).

---

## 1. Triage (first 5 minutes)

| Check | Command / action | Healthy signal |
|-------|------------------|----------------|
| Public health | `curl -fsSI https://viger.cloud/midnight/api/health` | HTTP 200, body `{"ok":true}` |
| App process | `pm2 status midnight-epos` | `online`, stable restarts |
| Recent errors | `pm2 logs midnight-epos --lines 80 --nostream` | No repeating stack traces |
| Nginx | `sudo tail -n 50 /var/log/nginx/error.log` | No upstream flood |
| Database | Neon status page + `npm run migration:sanity` on VPS | Sanity passes |
| Deploy config | `grep -E '^(APP_BASE_PATH|VITE_BASE_PATH|AUTH_PROVIDER|DATABASE_URL)=' .env` | `APP_BASE_PATH=/midnight`, `AUTH_PROVIDER=clerk`, `DATABASE_URL` set |

If health is **200** but users report issues, suspect **browser/service worker cache** (see §4).

---

## 2. Symptom → action

### Site down / 502 Bad Gateway

1. `pm2 status` — if **stopped** or **errored**: `cd /var/www/midnight-epos && npm run deploy:restart`.
2. If restart loops: `pm2 logs midnight-epos --lines 100` — common causes: missing `CLERK_SECRET_KEY`, invalid `DATABASE_URL`, `DEV_AUTH_BYPASS=1` in production.
3. Nginx upstream: confirm app listens on `127.0.0.1:5000` (`ss -lntp | grep 5000`).
4. `sudo nginx -t && sudo systemctl reload nginx`.
5. Last resort after config fix: `npm run deploy:build && npm run deploy:restart`.

### API up but wrong data / 500 on tenant routes

1. Check Neon connectivity and connection limit exhaustion.
2. Run `npm run migration:sanity`; apply missing files under `migrations/` in order (see [SCHEMA_EVOLUTION.md](../SCHEMA_EVOLUTION.md)).
3. Review outbox metrics if deployed: `curl -fsS https://viger.cloud/midnight/api/health/metrics`.

### Auth loop / Clerk redirect error

1. Clerk Dashboard → **Paths / URLs**: allowed origins include `https://viger.cloud`, callback paths match `/midnight`.
2. `.env`: `CLERK_PUBLISHABLE_KEY` matches `VITE_CLERK_PUBLISHABLE_KEY`; `AUTH_PROVIDER=clerk`.
3. After key change: `npm run deploy:build && npm run deploy:restart`.
4. User-side: hard refresh or incognito; stale SW can cache old `index.html` (§4).

### Imports fail with 413

- Nginx `client_max_body_size 25m;` and app on current `main` — see [DEPLOY_HOSTINGER_VPS.md](../DEPLOY_HOSTINGER_VPS.md) §10.

### Suspected credential leak

1. Follow [SECRET_ROTATION_RUNBOOK.md](../SECRET_ROTATION_RUNBOOK.md) for affected secrets.
2. Review **Audit log** in app for the incident window.

---

## 3. Communication

1. Post status internally (who is impacted, ETA unknown/15m/1h).
2. If DB restore required, follow [DISASTER_RECOVERY.md](../DISASTER_RECOVERY.md) — **do not** overwrite production without explicit approval.
3. When resolved, confirm health + one manual sign-in + one POS or dashboard load.

---

## 4. Service worker / cache (user-visible “stuck” UI)

After a bad deploy or asset mismatch:

- Advise users: hard refresh (Ctrl+Shift+R) or clear site data for `viger.cloud`.
- Operators: ensure `VITE_BASE_PATH=/midnight` before `npm run deploy:build`.

---

## 5. Post-incident

| Step | Action |
|------|--------|
| Timeline | Note start, detection, mitigation, resolution (UTC) |
| Audit | Super-admin **Audit log** for access changes during window |
| Errors | If `SENTRY_DSN` is set, review Sentry for exception spike |
| Secrets | Rotate if compromise suspected — [SECRET_ROTATION_RUNBOOK.md](../SECRET_ROTATION_RUNBOOK.md) |
| DR | If data loss, schedule restore drill follow-up per [DISASTER_RECOVERY.md](../DISASTER_RECOVERY.md) |

---

## Quick reference

```bash
# On VPS as deploy user
cd /var/www/midnight-epos
curl -fsS https://viger.cloud/midnight/api/health
pm2 status
pm2 logs midnight-epos --lines 50 --nostream
npm run migration:sanity
npm run deploy:restart
```

## Related

- [DEPLOY_HOSTINGER_VPS.md](../DEPLOY_HOSTINGER_VPS.md) — deploy and troubleshooting table
- [SECURITY_REVIEW.md](../SECURITY_REVIEW.md) — security posture and audit retention
- [SECRET_ROTATION_RUNBOOK.md](../SECRET_ROTATION_RUNBOOK.md) — credential rotation
