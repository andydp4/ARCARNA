#!/usr/bin/env bash
# MidnightEPOS — Hostinger VPS helper (run ON THE SERVER inside the MidnightEPOS folder)
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=".env.production"
COMPOSE="docker compose --env-file ${ENV_FILE}"

usage() {
  cat <<'EOF'
MidnightEPOS Hostinger helper

Run these ON THE SERVER (after SSH), inside the MidnightEPOS folder:

  ./scripts/hostinger-deploy.sh install   First-time setup (start app + database setup)
  ./scripts/hostinger-deploy.sh update    After git pull — rebuild, migrate, restart
  ./scripts/hostinger-deploy.sh status    Check if app is running
  ./scripts/hostinger-deploy.sh logs      Tail app logs (Ctrl+C to exit)
  ./scripts/hostinger-deploy.sh stop      Stop the app (data is kept)
EOF
}

require_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "ERROR: Missing $ENV_FILE"
    echo "Run: cp .env.production.example .env.production"
    echo "Then edit the passwords (see docs/DEPLOYMENT_HOSTINGER_VPS.md)"
    exit 1
  fi
}

apply_migrations() {
  echo "=== Applying database migrations ==="
  local user db
  user=$(grep -E '^POSTGRES_USER=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' || echo midnight)
  db=$(grep -E '^POSTGRES_DB=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' || echo midnight_epos)

  for f in migrations/001_analytics_org_pk_with_org.sql \
           migrations/002_org_not_null.sql \
           migrations/003_org_setup_phase8.sql \
           migrations/004_phase10_automation.sql \
           migrations/005_phase11a_location_stock_transfers.sql \
           migrations/006_phase11b_suppliers_replenishment.sql \
           migrations/007_phase11c_goods_receiving.sql \
           migrations/008_auth_subject.sql; do
    if [[ -f "$f" ]]; then
      echo "  Applying $(basename "$f")..."
      $COMPOSE exec -T postgres psql -U "$user" -d "$db" < "$f" || {
        echo "  (note: some messages about 'already exists' are OK on re-run)"
      }
    else
      echo "  WARNING: missing $f — skip"
    fi
  done
}

run_stock_backfill() {
  echo "=== Stock location backfill (product_location_stock) ==="
  if $COMPOSE exec -T app npx tsx scripts/backfill-product-location-stock.ts; then
    echo "  Backfill finished."
  else
    echo "  WARNING: Backfill failed. Smart Stock may be empty until this succeeds."
    echo "  Retry: docker compose --env-file .env.production exec app npx tsx scripts/backfill-product-location-stock.ts"
    return 1
  fi
}

cmd_install() {
  require_env
  echo "=== Step 1/5: Building and starting MidnightEPOS (5–15 minutes first time) ==="
  $COMPOSE up -d --build

  echo "=== Step 2/5: Waiting for database to be ready ==="
  sleep 25

  echo "=== Step 3/5: Applying database migrations ==="
  apply_migrations

  echo "=== Step 4/5: Stock location backfill ==="
  run_stock_backfill || true

  cmd_status
  echo ""
  echo "SUCCESS: Install finished."
  echo "Open in your browser: http://YOUR-SERVER-IP:5000"
  echo "(Replace YOUR-SERVER-IP with the number from Hostinger → VPS → IP address)"
}

cmd_update() {
  require_env
  echo "=== Updating MidnightEPOS ==="
  local branch
  branch="$(git rev-parse --abbrev-ref HEAD)"
  echo "Pulling origin/${branch}..."
  git pull origin "$branch"
  $COMPOSE up -d --build
  sleep 15
  apply_migrations
  run_stock_backfill || true
  cmd_status
  echo "Update finished. Refresh your browser."
}

cmd_status() {
  require_env
  echo "=== Container status ==="
  $COMPOSE ps
  echo ""
  echo "=== Health check ==="
  if curl -sf "http://127.0.0.1:5000/api/health" >/dev/null 2>&1; then
    curl -s "http://127.0.0.1:5000/api/health"
    echo ""
    echo "OK: App is responding."
  else
    echo "NOT READY YET: App is not responding on port 5000."
    echo "Wait 2 minutes, then run: ./scripts/hostinger-deploy.sh status"
    echo "If still failing: ./scripts/hostinger-deploy.sh logs"
    exit 1
  fi
}

cmd_stop() {
  require_env
  $COMPOSE down
  echo "Stopped. Your database data is saved (not deleted)."
}

cmd_logs() {
  require_env
  $COMPOSE logs -f --tail=100 app
}

case "${1:-}" in
  install) cmd_install ;;
  update) cmd_update ;;
  status) cmd_status ;;
  stop) cmd_stop ;;
  logs) cmd_logs ;;
  *) usage; exit 1 ;;
esac
