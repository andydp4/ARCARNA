# Production environment variables (technical reference)

**If you are deploying on Hostinger, start with [DEPLOY_HOSTINGER_VPS.md](./DEPLOY_HOSTINGER_VPS.md)** — that is the simple step-by-step guide. This page is for lookup only.

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

## Auth (Clerk — production default)

| Variable | Purpose |
|----------|---------|
| `AUTH_PROVIDER` | `clerk` (default) or `replit` for rollback |
| `CLERK_PUBLISHABLE_KEY` | Clerk frontend key (`pk_live_...`) — also used by `/api/auth/runtime` |
| `VITE_CLERK_PUBLISHABLE_KEY` | Same key; embedded at `npm run build` for Clerk React |
| `VITE_AUTH_PROVIDER` | `clerk` (default) — prevents Replit login UI when runtime API is slow |
| `CLERK_SECRET_KEY` | Clerk backend secret (`sk_live_...`) — never log or commit |

Owner setup: [AUTH_SETUP_CLERK.md](./AUTH_SETUP_CLERK.md)

## Auth (Replit OIDC — legacy fallback)

Only when `AUTH_PROVIDER=replit`:

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

Handled by deploy scripts or `psql` — applies `migrations/001` through `009` in order.

PM2 deploy: [DEPLOY_HOSTINGER_VPS.md](./DEPLOY_HOSTINGER_VPS.md)

## Backfill

Handled by install script after migration `005` — `scripts/backfill-product-location-stock.ts`.
