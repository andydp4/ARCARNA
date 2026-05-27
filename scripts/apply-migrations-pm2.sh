#!/usr/bin/env bash
# Apply SQL migrations on PM2 + Neon (no Docker). Safe to re-run (uses IF NOT EXISTS).
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set. Add it to .env (Neon pooler URL with sslmode=require)."
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql not found. Install: sudo apt install -y postgresql-client"
  exit 1
fi

echo "=== Applying SQL migrations to Neon ==="

for f in migrations/001_analytics_org_pk_with_org.sql \
         migrations/002_org_not_null.sql \
         migrations/003_org_setup_phase8.sql \
         migrations/004_phase10_automation.sql \
         migrations/005_phase11a_location_stock_transfers.sql \
         migrations/006_phase11b_suppliers_replenishment.sql \
         migrations/007_phase11c_goods_receiving.sql \
         migrations/008_auth_subject.sql \
         migrations/009_domain_outbox_and_workers.sql \
         migrations/010_domain_outbox_deprecated.sql; do
  if [[ ! -f "$f" ]]; then
    echo "  SKIP missing $f"
    continue
  fi
  echo "  → $(basename "$f")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -f "$f" || {
    echo "  (some 'already exists' notices are OK on re-run)"
  }
done

echo "=== migration:sanity ==="
npm run migration:sanity

echo "OK: Migrations finished."
