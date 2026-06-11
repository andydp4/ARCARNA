# Deploy MidnightEPOS on Hostinger VPS (Node 20 + PM2 + Nginx)

Production site: **https://viger.cloud** (portal) · **https://viger.cloud/midnight** (Midnight EPOS)

This guide matches the **current VPS layout** (Node/PM2/Nginx). For Docker Compose instead, see [DEPLOYMENT_HOSTINGER_VPS.md](./DEPLOYMENT_HOSTINGER_VPS.md).

---

## Security warning

If database credentials were ever pasted in chat, email, or committed to git:

1. **Rotate the Neon/Postgres password** in your database dashboard.
2. Update `DATABASE_URL` in `/var/www/midnight-epos/.env` (or your app path).
3. Restart the app: `npm run deploy:restart`

Never commit `.env` to GitHub.

---

## What you need

| Item | Notes |
|------|--------|
| Hostinger VPS | Ubuntu 22.04+ |
| Domain | `viger.cloud` → VPS IP |
| GitHub repo | `andydp4/MidnightEPOS` branch **`main`** (V1.0 test) |
| Clerk account | API keys + redirect URLs for `https://viger.cloud` |
| PostgreSQL | Neon or VPS Postgres `DATABASE_URL` |

---

## 1. On the VPS — install Node 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential
node -v   # v20.x
npm -v
```

Install PM2 and Nginx:

```bash
sudo npm install -g pm2
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

---

## 2. Clone or update the app

**First time:**

```bash
sudo mkdir -p /var/www/midnight-epos
sudo chown $USER:$USER /var/www/midnight-epos
cd /var/www/midnight-epos
git clone https://github.com/andydp4/MidnightEPOS.git .
git checkout main
git pull origin main
```

**Updates:**

```bash
cd /var/www/midnight-epos
git fetch origin
git checkout main
git pull origin main
```

---

## 3. Environment file

```bash
cp .env.production.example .env
nano .env
```

**Required for production (Clerk):**

| Variable | Example |
|----------|---------|
| `NODE_ENV` | `production` |
| `PORT` | `5000` |
| `DATABASE_URL` | `postgresql://...` (Neon **pooler** URL with `?sslmode=require` — host contains `-pooler.neon.tech`) |
| `SESSION_SECRET` | 32+ random characters |
| `AUTH_PROVIDER` | `clerk` |
| `CLERK_SECRET_KEY` | `sk_live_...` |
| `CLERK_PUBLISHABLE_KEY` | `pk_live_...` |
| `VITE_AUTH_PROVIDER` | `clerk` |
| `VITE_CLERK_PUBLISHABLE_KEY` | same as publishable key |
| `CLERK_ACCOUNTS_URL` | `https://accounts.viger.cloud` |
| `VITE_CLERK_ACCOUNTS_URL` | same (baked in at build) |
| `VITE_APP_URL` | `https://viger.cloud/midnight` |
| `VITE_BASE_PATH` | `/midnight` |
| `APP_BASE_PATH` | `/midnight` |
| `DEV_AUTH_BYPASS` | `0` or unset |

**Clerk dashboard** → Paths / Account Portal:

- Sign-in: `https://accounts.viger.cloud/sign-in`
- Sign-up: `https://accounts.viger.cloud/sign-up`
- After sign-in / home: `https://viger.cloud/midnight/`
- DNS: `accounts.viger.cloud` records from Clerk → Domains

See [AUTH_SETUP_CLERK.md](./AUTH_SETUP_CLERK.md).

---

## 4. Install, build, migrate

```bash
cd /var/www/midnight-epos
npm install
npm run build
```

Apply SQL migrations (runs `001`–`014` in order, including `admin_audit_logs` and `feature_flags`):

```bash
sudo apt install -y postgresql-client   # once, if psql is missing
source .env
bash scripts/apply-migrations-pm2.sh
```

Or `npm run db:migrate` if you use that path — but **raw SQL under `migrations/` is not always applied by `db:push` alone**. If `014` failed with `relation "admin_audit_logs" does not exist`, run `bash scripts/apply-migrations-pm2.sh` (014 now creates the table if missing).

Or apply only the Clerk migration:

```bash
source .env
psql "$DATABASE_URL" -f migrations/008_auth_subject.sql
```

Sanity check:

```bash
npm run migration:sanity
```

Stock backfill (after org/products exist):

```bash
npx tsx scripts/backfill-product-location-stock.ts
```

Optional schema sync:

```bash
npx drizzle-kit push
```

---

## 5. PM2 — start / restart

Production uses `ecosystem.config.cjs` (`NODE_ENV=production`, `.env`, logs under `logs/`).

**First start:**

```bash
npm run deploy:build
npm run deploy:start
pm2 save
pm2 startup
```

**Full deploy (pull, install, build, restart):**

```bash
npm run deploy
# or: bash scripts/deploy-production.sh
```

**Restart after `.env` changes only:**

```bash
npm run deploy:restart
```

**Logs:**

```bash
pm2 logs midnight-epos --lines 100
# or: tail -f logs/pm2-out.log logs/pm2-error.log
```

**Health:**

```bash
curl -s http://127.0.0.1:5000/api/health
```

Success: `{"ok":true,...}` — must not return Clerk publishable-key errors (health is unauthenticated).

---

## 6. Nginx reverse proxy

Create `/etc/nginx/sites-available/viger.cloud`:

```nginx
server {
    listen 80;
    server_name viger.cloud www.viger.cloud;

    # Required for .vcf / CSV / XLSX imports (default 1m → HTTP 413)
    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable and test:

```bash
sudo ln -sf /etc/nginx/sites-available/viger.cloud /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 7. HTTPS (Certbot)

```bash
sudo certbot --nginx -d viger.cloud -d www.viger.cloud
```

Set in `.env` after HTTPS:

```env
SESSION_COOKIE_SECURE=1
```

### HTTP security headers

| Header / policy | Set by | Notes |
|-----------------|--------|--------|
| **HSTS** (`Strict-Transport-Security`) | **Nginx** (HTTPS `server` block) | Add after Certbot: `add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;` — see `deploy/nginx-viger.cloud.conf.example`. Verify: `curl -sI https://viger.cloud/midnight/api/health` includes the header. |
| **Helmet defaults** (e.g. `X-Content-Type-Options`, `X-Frame-Options`) | **Node** (`server/security.ts`, production only) | Applied when `NODE_ENV=production`. |
| **Content-Security-Policy** | **Off in Node** | Helmet CSP is disabled so Vite inline bootstraps and Clerk sign-in (`/midnight/sign-in` → `accounts.viger.cloud`) work without console violations. Optional strict CSP at nginx for static assets only — not required for API/HTML shell. |
| **Rate limits** | **Node** (`server/security.ts`) | Global `/api/*`: 800 req / 15 min (prod). `/api/auth/*`: 20 / min. `/api/*/import*`: 5 / min. Health probes (`/api/health`, `/api/auth/runtime`) exempt from global limiter. |

Rebuild/restart if you change `VITE_*` keys:

```bash
npm run deploy:build
npm run deploy:restart
```

---

## 8. Update workflow (routine deploy)

```bash
cd /root/MidnightEPOS   # or /var/www/midnight-epos
git pull origin main

# Important: do not run npm ci while NODE_ENV=production is exported (e.g. from sourcing .env).
unset NODE_ENV
npm ci --include=dev
npm run build

set -a && source .env && set +a
bash scripts/apply-migrations-pm2.sh
pm2 restart midnight-epos --update-env
curl -sS http://127.0.0.1:5000/midnight/api/health
```

**Sentry sourcemaps on VPS:** If build logs `Invalid token (401)` from `@sentry/vite-plugin`, either set a valid `SENTRY_AUTH_TOKEN` or remove that line from `.env` (runtime error reporting via `SENTRY_DSN` still works; only upload fails).

Open https://viger.cloud — you should see the **Viger Cloud** portal. Open **Midnight EPOS** or go to https://viger.cloud/midnight for **Sign in** (Clerk).

---

## 9. Smoke test

Use [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md).

---

## 9b. Backup cron (Neon → R2)

Nightly logical dumps are optional but recommended. See [DISASTER_RECOVERY.md](./DISASTER_RECOVERY.md).

1. Install AWS CLI on the VPS (`apt install awscli` or pip).
2. Add `R2_*` variables to `.env` (see [`.env.production.example`](../.env.production.example)).
3. Ensure `pg_dump` 16+ is available (`postgresql-client-16`).
4. Install cron from [`scripts/cron.example`](../scripts/cron.example):

```bash
chmod +x /var/www/midnight-epos/scripts/backup-neon-to-r2.sh
# crontab -e — add the 02:15 UTC line from scripts/cron.example
```

Logs: `/var/log/midnight-backup.log`.

---

## 10. Import upload fails with HTTP 413

Large Apple Contacts `.vcf` exports need a higher upload limit on **Nginx** (default 1MB) and in the **Node** app (now 25MB on `main`).

On the VPS:

```bash
sudo nano /etc/nginx/sites-available/viger.cloud
```

Inside the `server { ... }` block, add:

```nginx
client_max_body_size 25m;
```

Then:

```bash
sudo nginx -t && sudo systemctl reload nginx
cd ~/MidnightEPOS   # or your app path
git pull origin main
npm install && npm run deploy
```

See also `deploy/nginx-viger.cloud.conf.example` in the repo.

---

## 11. Ops runbooks (Wave 0)

Production items that require VPS or external tooling (not app PRs):

| Brief | Doc |
|-------|-----|
| **O1** Uptime monitors | [ops/UPTIME_MONITORING.md](./ops/UPTIME_MONITORING.md) |
| **O2** Restore drill | [DISASTER_RECOVERY.md](./DISASTER_RECOVERY.md) |
| **O3** PM2 reboot persistence | §5 above + [ops/OPERATOR_CHECKLIST.md](./ops/OPERATOR_CHECKLIST.md) |
| **O4** Incidents | [ops/INCIDENT_CHECKLIST.md](./ops/INCIDENT_CHECKLIST.md) |
| **H1** HSTS verify | `bash scripts/verify-production-headers.sh` |

**Consolidated sign-off:** [ops/OPERATOR_CHECKLIST.md](./ops/OPERATOR_CHECKLIST.md)

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Replit login still shown | Set `AUTH_PROVIDER=clerk`, Clerk keys in `.env`, `npm run build`, restart PM2 |
| App exits on start | Check `CLERK_SECRET_KEY`, `SESSION_SECRET`, `DATABASE_URL` |
| Clerk redirect error | Add exact URLs in Clerk dashboard |
| `migration:sanity` fails | Run missing migration files in order |
| `tsx: not found` on VPS | `unset NODE_ENV` then `npm ci --include=dev` (or `npm install`); do not run `npm ci` while `.env` has `NODE_ENV=production` exported |
| 502 from Nginx | `pm2 status`, `pm2 logs midnight-epos`; confirm `dist/index.js` exists (`npm run build`); curl `http://127.0.0.1:5000/midnight/api/health` |
| Sentry `57P01` / "terminating connection due to administrator command" | Expected when Neon compute suspends or restarts. Use **pooler** `DATABASE_URL` (`-pooler.neon.tech`); app retries transient errors. One-off is normal — disable Neon scale-to-zero for production or accept wake latency on first query after idle. |
| Uptime monitor 404 on `/midnightepos` | Wrong path — use `GET /midnight/api/health` (note the slash after `midnight`). |
| High Neon CU-hours / transfer on Free plan | Set `WORKER_DISPATCH_INTERVAL_MS=5000`, `WORKER_PROCESS_INTERVAL_MS=2000`, `WORKER_CONCURRENCY=1` in `.env`; use pooler `DATABASE_URL`; poll `/api/health` not `/api/health/metrics` every minute |

For structured triage (health, PM2, nginx, auth loops, post-incident audit), use **[ops/INCIDENT_CHECKLIST.md](./ops/INCIDENT_CHECKLIST.md)**.

Send support: `pm2 logs` (last 50 lines), `npm run migration:sanity` output, redacted `.env` variable **names** only.
