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

# Every migration in migrations/, in version order. Do NOT reintroduce a
# hardcoded list here. The previous version of this script had one, it drifted
# three files behind the directory, and a production deploy silently applied
# nothing for 045 and 046 — no error, no "SKIP" line, just an unmigrated schema
# under a build that expected the new columns. Globbing cannot drift.
#
# Two files are excluded deliberately. Both are conditional Phase 2B analytics
# variants that an operator runs by hand, not part of the standard sequence:
#
#   001_analytics_org_pk.sql          — only for a pre-multi-tenant database;
#                                       its own header says fresh DBs use
#                                       `npm run db:push` instead.
#   001_analytics_org_pk_with_org.sql — requires `-v org_id=<uuid>`, which this
#                                       script has no way to supply.
#
# (Ordering note: sorting puts 031 before 032, where the old hardcoded list had
# them reversed. They are independent — 031 adds a column to organizations, 032
# creates customer_rfm — so version order is correct for both.)
MANUAL_ONLY=(
  "001_analytics_org_pk.sql"
  "001_analytics_org_pk_with_org.sql"
)

is_manual_only() {
  local candidate="$1" skip
  for skip in "${MANUAL_ONLY[@]}"; do
    [[ "$candidate" == "$skip" ]] && return 0
  done
  return 1
}

shopt -s nullglob
migration_files=(migrations/*.sql)
if [[ ${#migration_files[@]} -eq 0 ]]; then
  echo "ERROR: no migrations found under migrations/ — wrong working directory?"
  exit 1
fi

# Errors are collected, not ignored.
#
# This loop used to run psql with ON_ERROR_STOP=0 and swallow the exit code, so
# a migration that failed outright printed one ERROR line into a thousand lines
# of NOTICE and the deploy carried on to "SUCCESS". That is not hypothetical:
# 058 failed on its first production run — the unique index guarding against
# one person's trading day being split across two shifts was never created —
# and the deploy reported success over it. A silent half-migrated schema is the
# single worst outcome this script can produce.
#
# ON_ERROR_STOP stays 0 deliberately: every migration is IF NOT EXISTS, and
# stopping at the first "already exists" NOTICE-adjacent error would break
# re-runs. Instead each file is checked for real ERROR lines, and the script
# fails at the end naming every file that had one.
failed_migrations=()

while IFS= read -r f; do
  base="$(basename "$f")"
  if is_manual_only "$base"; then
    echo "  SKIP $base (manual-only — see MANUAL_ONLY in this script)"
    continue
  fi
  echo "  → $base"
  migration_log="$(mktemp)"
  if ! psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -f "$f" 2>&1 | tee "$migration_log"; then
    failed_migrations+=("$base (psql exited non-zero)")
  elif grep -qE '^psql:[^ ]+: ERROR:|^ERROR:' "$migration_log"; then
    failed_migrations+=("$base")
  fi
  rm -f "$migration_log"
done < <(printf '%s\n' "${migration_files[@]}" | sort -V)

if [[ ${#failed_migrations[@]} -gt 0 ]]; then
  echo ""
  echo "ERROR: ${#failed_migrations[@]} migration(s) reported an error:"
  for m in "${failed_migrations[@]}"; do
    echo "  - $m"
  done
  echo ""
  echo "  The schema is half-applied. Scroll up for the ERROR line from each"
  echo "  file — it names the constraint, index or column that did not take."
  echo "  Fix the data or the migration, then re-run; every file is"
  echo "  IF NOT EXISTS, so re-running costs nothing."
  exit 1
fi

echo "=== migration:sanity ==="
# npm ci with NODE_ENV=production (often set in .env) omits devDependencies and breaks `tsx`.
TSX_BIN="node_modules/.bin/tsx"
if [[ ! -x "$TSX_BIN" ]]; then
  echo "  tsx missing — installing (use: unset NODE_ENV && npm ci --include=dev)"
  npm install tsx@^4.20.6 --no-save --no-audit --no-fund
fi
"$TSX_BIN" scripts/migration-sanity-check.ts

echo "OK: Migrations finished."
