# Hostinger VPS deployment (Docker)

Deploy MidnightEPOS on a Hostinger VPS (or any Linux host with Docker).

## Prerequisites

- Ubuntu 22.04+ (or similar)
- Docker Engine + Docker Compose plugin
- Domain pointing to VPS (for HTTPS — configure reverse proxy separately)
- Replit OIDC app configured for your production domain

## 1. SSH into the server

```bash
ssh user@your-vps-ip
```

## 2. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# log out and back in
docker compose version
```

## 3. Clone the repository

```bash
git clone https://github.com/andydp4/MidnightEPOS.git
cd MidnightEPOS
git checkout main   # or recovery-stable-r7 / launch branch
```

## 4. Create production env file

```bash
cp .env.production.example .env.production
nano .env.production
```

Set at minimum:

- `POSTGRES_PASSWORD` — strong password
- `SESSION_SECRET` — 32+ random characters
- `REPL_ID`, `REPLIT_DOMAINS` — your OIDC settings
- `SESSION_COOKIE_SECURE=1` once HTTPS is enabled on the proxy

## 5. Build and start

```bash
docker compose --env-file .env.production up -d --build
docker compose ps
docker compose logs -f app
```

App listens on `APP_PORT` (default **5000**).

## 6. Run database migrations

Apply SQL in order against the Postgres instance (only migrations not already applied):

```bash
# From host, with psql client, or via docker exec:
for f in migrations/001_analytics_org_pk_with_org.sql \
         migrations/002_org_not_null.sql \
         migrations/003_org_setup_phase8.sql \
         migrations/004_phase10_automation.sql \
         migrations/005_phase11a_location_stock_transfers.sql \
         migrations/006_phase11b_suppliers_replenishment.sql \
         migrations/007_phase11c_goods_receiving.sql; do
  echo "Applying $f"
  docker compose exec -T postgres psql -U midnight -d midnight_epos < "$f"
done
```

Skip any file already applied in your environment.

## 7. Backfill per-location stock

After migration `005`:

```bash
docker compose exec app npx tsx scripts/backfill-product-location-stock.ts
```

## 8. Verify health

```bash
curl -s http://127.0.0.1:5000/api/health
# {"ok":true,"nodeEnv":"production","dbDriver":"node-postgres"}
```

## 9. Reverse proxy + SSL (recommended)

Use **nginx** or **Caddy** on the host (not included in `docker-compose.yml`):

- Proxy `https://your-domain` → `http://127.0.0.1:5000`
- Terminate TLS at the proxy
- Set `SESSION_COOKIE_SECURE=1` in `.env.production`
- Restart app: `docker compose --env-file .env.production up -d app`

Example Caddy snippet:

```text
your-domain.example.com {
  reverse_proxy localhost:5000
}
```

## 10. Updates

```bash
git pull origin main
docker compose --env-file .env.production up -d --build
# re-run any new migrations only
```

## Troubleshooting

| Issue | Check |
|-------|--------|
| App exits on start | `docker compose logs app` — missing `SESSION_SECRET` or `DEV_AUTH_BYPASS=1` |
| DB connection failed | `DATABASE_URL`, postgres health, `DB_DRIVER=node-postgres` |
| Auth redirect errors | `REPLIT_DOMAINS`, HTTPS cookie settings |
| No stock on replenishment | Run migration `005` + backfill script |

## Persistent data

Postgres data is stored in Docker volume `pgdata`. Back up with:

```bash
docker compose exec postgres pg_dump -U midnight midnight_epos > backup.sql
```
