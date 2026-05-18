# Production environment variables (technical reference)

**If you are deploying on Hostinger, start with [DEPLOYMENT_HOSTINGER_VPS.md](./DEPLOYMENT_HOSTINGER_VPS.md)** — that is the simple step-by-step guide. This page is for lookup only.

## Required in production

| Variable | Purpose |
|----------|---------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | PostgreSQL connection string (set automatically in Docker Compose) |
| `SESSION_SECRET` | Session signing (min 32 characters) |
| `PORT` | HTTP port (default `5000`) |

## Docker Compose file

Copy `.env.production.example` → `.env.production` on the server. The install script reads this file.

## Must stay off in production

| Variable | Value |
|----------|--------|
| `DEV_AUTH_BYPASS` | `0` or unset — app refuses to start if `1` |

## Auth (Replit OIDC)

| Variable | Purpose |
|----------|---------|
| `REPL_ID` | OAuth client id |
| `REPLIT_DOMAINS` | Your production hostname |

## Session cookie

| Variable | Purpose |
|----------|---------|
| `SESSION_COOKIE_SECURE` | `0` for `http://IP:5000` tests; `1` when HTTPS is enabled |

## Database driver

| Variable | Purpose |
|----------|---------|
| `DB_DRIVER` | `node-postgres` on Hostinger Docker (default in compose) |

## Health check

`GET /api/health` → `{ "ok": true }`

## Migrations (first install)

Handled by `./scripts/hostinger-deploy.sh install` — applies `migrations/001` through `007` in order.

## Backfill

Handled by install script after migration `005` — `scripts/backfill-product-location-stock.ts`.
