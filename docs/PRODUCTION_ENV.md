# Production environment variables

## Required

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | Must be `production` |
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Session signing secret (min 32 characters) |
| `PORT` | HTTP port (default `5000`) |

## Database driver

| Variable | Description |
|----------|-------------|
| `DB_DRIVER` | `node-postgres` (Docker/local Postgres) or `neon` (Neon serverless). Auto-detects from URL if unset (`neon.tech` → neon). |

## Auth (Replit OIDC)

| Variable | Description |
|----------|-------------|
| `REPL_ID` | OAuth client id |
| `ISSUER_URL` | OIDC issuer (default `https://replit.com/oidc`) |
| `REPLIT_DOMAINS` | Comma-separated allowed callback hostnames |

## Session cookie

| Variable | Description |
|----------|-------------|
| `SESSION_COOKIE_SECURE` | `1` when HTTPS terminates at proxy; `0` for plain HTTP behind internal proxy during setup |

## Must be disabled in production

| Variable | Production value |
|----------|------------------|
| `DEV_AUTH_BYPASS` | unset or `0` — app **fails to start** if `1` with `NODE_ENV=production` |
| `PHASE2D_TEST` | unset or `0` |

## Optional

| Variable | Description |
|----------|-------------|
| `PHASE2D_TEST_SECRET` | Test-only; never set in production |

## Startup validation

`server/validateProductionEnv.ts` runs before the HTTP server binds. It enforces `DATABASE_URL`, production `SESSION_SECRET`, and blocks `DEV_AUTH_BYPASS` in production.

## Health check

`GET /api/health` — returns `{ ok: true, nodeEnv, dbDriver }` (no auth).

## Workers

On startup (when `DATABASE_URL` is set):

- Event-driven worker runner (`server/workers`)
- Reconciliation job (event bus)
- Optional analytics worker (non-critical if missing)

Workers stop on `SIGTERM`.

## PDF / invoices

- Primary path: `pdfkit` (bundled fonts, no Chromium required)
- Puppeteer/Chromium path may be stubbed in production (`server/engine.wiring.ts`)

## File storage

- Product/customer imports: in-memory parse (CSV/XLSX upload); no persistent upload volume required
- Session store: PostgreSQL `sessions` table via `connect-pg-simple`
