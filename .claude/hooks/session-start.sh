#!/bin/bash
#
# SessionStart hook — brings the dev environment up so tests, linters and the
# DB-backed integration suite work in Claude Code on the web.
#
# The container has no init system (PID 1 is process_api, systemctl reports
# "offline"), so nothing supervises PostgreSQL. It is started manually and dies
# whenever the container suspends between turns. This hook restarts it, and is
# safe to run repeatedly.
#
set -euo pipefail

# Local machines manage their own services; only do this in the web container.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

PG_VERSION=16
DB_NAME=midnight_dev
DB_URL="postgresql://postgres:postgres@localhost:5432/${DB_NAME}"

log() { echo "[session-start] $*"; }

# --- PostgreSQL ------------------------------------------------------------
if pg_isready -U postgres -q 2>/dev/null; then
  log "postgres already running"
else
  log "starting postgres ${PG_VERSION}"
  # Non-zero when already running or on a stale pid file it then clears.
  sudo pg_ctlcluster "$PG_VERSION" main start 2>/dev/null \
    || pg_ctlcluster "$PG_VERSION" main start 2>/dev/null \
    || true

  ready=0
  for _ in $(seq 1 30); do
    if pg_isready -U postgres -q 2>/dev/null; then
      ready=1
      break
    fi
    sleep 1
  done
  if [ "$ready" -ne 1 ]; then
    log "ERROR: postgres did not become ready within 30s"
    exit 1
  fi
  log "postgres ready"
fi

# Password login is what DATABASE_URL uses; the socket peer login is separate.
sudo -u postgres psql -qtAc "ALTER USER postgres PASSWORD 'postgres';" >/dev/null 2>&1 || true

if ! sudo -u postgres psql -qtAc \
  "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}';" 2>/dev/null | grep -q 1; then
  log "creating database ${DB_NAME}"
  sudo -u postgres createdb "$DB_NAME" 2>/dev/null || true
fi

# --- Environment -----------------------------------------------------------
# The repo does not auto-load .env, and apply-migrations-pm2.sh sources it.
if [ ! -f .env ]; then
  log "writing .env"
  cat > .env << ENVEOF
NODE_ENV=development
PORT=5000
DATABASE_URL=${DB_URL}
SESSION_SECRET=dev_session_secret_at_least_32_characters
DEV_AUTH_USER_ID=seed-cashier
VITE_BASE_PATH=/arcarna
APP_BASE_PATH=/arcarna
ENVEOF
fi

# Export for the session so commands do not each need `source .env`.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo "export DATABASE_URL='${DB_URL}'"
    echo "export SESSION_SECRET='dev_session_secret_at_least_32_characters'"
    echo "export NODE_ENV='development'"
    echo "export PORT='5000'"
    echo "export APP_BASE_PATH='/arcarna'"
    echo "export VITE_BASE_PATH='/arcarna'"
    echo "export DEV_AUTH_USER_ID='seed-cashier'"
  } >> "$CLAUDE_ENV_FILE"
fi

export DATABASE_URL="$DB_URL"

# --- Dependencies ----------------------------------------------------------
if [ ! -d node_modules ]; then
  log "installing npm dependencies"
  npm install --no-audit --no-fund
else
  log "node_modules present"
fi

# --- Schema ----------------------------------------------------------------
log "applying schema"
npm run db:push --silent >/dev/null 2>&1 || {
  log "ERROR: db:push failed"
  exit 1
}

# Idempotent by design (IF NOT EXISTS throughout).
bash scripts/apply-migrations-pm2.sh >/dev/null 2>&1 || {
  log "ERROR: migrations failed"
  exit 1
}

# --- Seed (once only) ------------------------------------------------------
# scripts/seed.ts inserts unconditionally, so re-running it creates duplicate
# organizations. Seed only when the database has none.
org_count="$(psql "$DB_URL" -tAc 'SELECT count(*) FROM organizations;' 2>/dev/null || echo 0)"
if [ "${org_count:-0}" = "0" ]; then
  log "seeding fresh database"
  npm run seed --silent >/dev/null 2>&1 || log "WARNING: seed failed (continuing)"
  npx tsx scripts/backfill-product-location-stock.ts >/dev/null 2>&1 || true
else
  log "database already seeded (${org_count} org(s)) — skipping seed"
fi

# scripts/seed.ts leaves setup_complete = 0, so the SPA redirects every
# navigation to /setup-wizard. Browser tests then silently exercise the wizard
# instead of the app. Idempotent, so it runs on every start.
psql "$DB_URL" -qtAc 'UPDATE organizations SET setup_complete = 1 WHERE setup_complete IS DISTINCT FROM 1;' >/dev/null 2>&1 || true

log "ready"
