# AGENTS.md

## Cursor Cloud specific instructions

### Product

**ARCARNA EPOS** is a TypeScript monolith: Express API + React/Vite SPA (PWA) on port **5000**, mounted at **`/arcarna`** by default (`APP_BASE_PATH` / `VITE_BASE_PATH`). Legacy **`/midnight`** URLs 301 to `/arcarna`. A static owner portal is served at `/`. See `ARCHITECTURE.md` and `package.json` scripts.

### Services (local dev)

| Service | Required | Notes |
|---------|----------|--------|
| **PostgreSQL 16** | Yes | `DATABASE_URL` is mandatory even in dev (`server/validateProductionEnv.ts`). |
| **`npm run dev`** | Yes | Sets `DEV_AUTH_BYPASS=1`; API + Vite client + in-process workers. |
| **Clerk / Replit auth** | No (local) | Bypassed in dev via `npm run dev`. |

### Environment file

The repo does **not** auto-load `.env` for all commands. Create `.env` from `.env.production.example` (minimal dev example below), then **source it** before DB/seed/dev commands:

```bash
set -a && source .env && set +a
```

Minimal dev `.env`:

```bash
NODE_ENV=development
PORT=5000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/midnight_dev
SESSION_SECRET=dev_session_secret_at_least_32_characters
DEV_AUTH_USER_ID=seed-cashier
VITE_BASE_PATH=/arcarna
APP_BASE_PATH=/arcarna
```

Use URLs under **`http://localhost:5000/arcarna/`** (not bare `/api/*`).

### PostgreSQL on Cloud Agent VMs

Docker is often unavailable. Install and start Postgres via apt:

```bash
sudo apt-get install -y postgresql postgresql-client
sudo pg_ctlcluster 16 main start
sudo -u postgres psql -c "CREATE DATABASE midnight_dev;"  # once
```

### First-time database setup (after `npm ci`)

Run **once** per fresh DB (do not run `npm run seed` repeatedly — it creates duplicate orgs):

```bash
set -a && source .env && set +a
npm run db:push
bash scripts/apply-migrations-pm2.sh   # applies migrations/*.sql (CI parity)
npm run seed
npx tsx scripts/backfill-product-location-stock.ts
```

**POS / location stock gotcha:** `products.stock` is a legacy display field (often `0` after backfill). Authoritative stock is `product_location_stock`. After backfill, sync display stock for the seeded location so the POS UI shows items as in stock:

```bash
# Replace ORG_ID and LOC_ID from seed output / locations table
psql "$DATABASE_URL" -c "
  UPDATE products p SET stock = pls.stock
  FROM product_location_stock pls
  WHERE pls.product_id = p.id AND pls.location_id = 'LOC_ID' AND p.org_id = 'ORG_ID';
"
UPDATE organizations SET setup_complete = 1 WHERE name = 'Midnight Demo Org';
```

**Legacy domain engine tables:** Order creation via `apps/server` may need `audit_logs` and `domain_outbox` if missing after `db:push` alone — `bash scripts/apply-migrations-pm2.sh` normally creates `domain_outbox`; create `audit_logs` from `apps/server/src/db/schema.ts` if you see `relation "audit_logs" does not exist`.

### Standard commands

| Task | Command |
|------|---------|
| Install deps | `npm ci` |
| Dev server | `set -a && source .env && set +a && npm run dev` |
| Typecheck | `npm run check` |
| Tests | `npm test` |
| Build | `set -a && source .env && set +a && npm run build` |
| Storage audit (CI) | `node scripts/audit-storage-orgid.mjs` |

Prefer **tmux** for long-running `npm run dev` (e.g. session `midnight-dev`).

### Dev auth

`npm run dev` enables `DEV_AUTH_BYPASS=1`. Default user is `dev-user`; set `DEV_AUTH_USER_ID=seed-cashier` (or other seed users from `scripts/seed.ts`) for org-scoped POS flows.

### Hello-world verification

1. `curl http://localhost:5000/arcarna/api/health` → `{"ok":true,...}`
2. Open `http://localhost:5000/arcarna/pos`, add a product, complete a cash sale.
3. Or `POST /arcarna/api/orders` with session cookie after visiting the app once (see `packages/domain/src/schemas.ts` `PlaceOrderInput`).
