# Deploy MidnightEPOS on Hostinger VPS (Node 20 + PM2 + Nginx)

Production site: **https://viger.cloud**

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
| `DATABASE_URL` | `postgresql://...` (Neon with `?sslmode=require`) |
| `SESSION_SECRET` | 32+ random characters |
| `AUTH_PROVIDER` | `clerk` |
| `CLERK_SECRET_KEY` | `sk_live_...` |
| `CLERK_PUBLISHABLE_KEY` | `pk_live_...` |
| `VITE_AUTH_PROVIDER` | `clerk` |
| `VITE_CLERK_PUBLISHABLE_KEY` | same as publishable key |
| `DEV_AUTH_BYPASS` | `0` or unset |

**Clerk dashboard** → Paths / redirect URLs:

- Sign-in: `https://viger.cloud/sign-in`
- After sign-in: `https://viger.cloud/`
- After sign-out: `https://viger.cloud/`

See [AUTH_SETUP_CLERK.md](./AUTH_SETUP_CLERK.md).

---

## 4. Install, build, migrate

```bash
cd /var/www/midnight-epos
npm install
npm run build
```

Apply SQL migrations (order matters):

```bash
export $(grep -v '^#' .env | xargs)
for f in migrations/001_analytics_org_pk_with_org.sql \
         migrations/002_org_not_null.sql \
         migrations/003_org_setup_phase8.sql \
         migrations/004_phase10_automation.sql \
         migrations/005_phase11a_location_stock_transfers.sql \
         migrations/006_phase11b_suppliers_replenishment.sql \
         migrations/007_phase11c_goods_receiving.sql \
         migrations/008_auth_subject.sql \
         migrations/009_domain_outbox_and_workers.sql; do
  echo "Applying $f..."
  psql "$DATABASE_URL" -f "$f" || echo "(some 'already exists' messages are OK)"
done
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

Rebuild/restart if you change `VITE_*` keys:

```bash
npm run deploy:build
npm run deploy:restart
```

---

## 8. Update workflow (routine deploy)

```bash
cd /var/www/midnight-epos
git pull origin main
npm install
npm run deploy:build
export $(grep -v '^#' .env | xargs)
psql "$DATABASE_URL" -f migrations/009_domain_outbox_and_workers.sql 2>/dev/null || true
npm run migration:sanity
npm run deploy:restart
```

Open https://viger.cloud — you should see **Sign in** (Clerk), not “Login with Replit”.

---

## 9. Smoke test

Use [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md).

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Replit login still shown | Set `AUTH_PROVIDER=clerk`, Clerk keys in `.env`, `npm run build`, restart PM2 |
| App exits on start | Check `CLERK_SECRET_KEY`, `SESSION_SECRET`, `DATABASE_URL` |
| Clerk redirect error | Add exact URLs in Clerk dashboard |
| `migration:sanity` fails | Run missing migration files in order |
| 502 from Nginx | `pm2 status`, `pm2 logs midnight-epos` |

Send support: `pm2 logs` (last 50 lines), `npm run migration:sanity` output, redacted `.env` variable **names** only.
