#!/usr/bin/env bash
# Wave 10 preflight — run before VPS deploy or release tag.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== MidnightEPOS Wave 10 Preflight ==="
echo "Commit: $(git log -1 --oneline 2>/dev/null || echo 'unknown')"
echo ""

FAIL=0

run_step() {
  local name="$1"
  shift
  echo "→ $name"
  if "$@"; then
    echo "  ✓ $name"
  else
    echo "  ✗ $name FAILED"
    FAIL=1
  fi
  echo ""
}

run_step "TypeScript (npm run check)" npm run check

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ -n "${DATABASE_URL:-}" ]]; then
  TSX_BIN="node_modules/.bin/tsx"
  if [[ ! -x "$TSX_BIN" ]]; then
    npm install tsx@^4.20.6 --no-save --no-audit --no-fund
  fi
  run_step "Migration sanity" "$TSX_BIN" scripts/migration-sanity-check.ts
else
  echo "→ Migration sanity — SKIPPED (DATABASE_URL not set)"
  echo ""
fi

run_step "Unit tests (vitest)" npm run test

run_step "Production hooks off" npx tsx scripts/assert-production-hooks-off.ts

echo "→ Worker registry (REQUIRED_WORKERS vs factories)"
if npx tsx scripts/verify-workers.ts; then
  echo "  ✓ Worker registry"
else
  echo "  ✗ Worker registry FAILED"
  FAIL=1
fi
echo ""

echo "→ npm audit (high+)"
npm audit --audit-level=high || true
echo "  (Review audit output above; non-zero audit does not fail preflight by default)"
echo ""

echo "→ UX legacy gradient scan"
if rg -l "bg-gradient-to-b from-slate-900|bg-gradient-to-br from-primary" client/src/pages 2>/dev/null; then
  echo "  ⚠ Pages still using legacy auth gradients (see above)"
else
  echo "  ✓ No legacy slate auth gradients in pages/"
fi
echo ""

if [[ "$FAIL" -ne 0 ]]; then
  echo "=== PREFLIGHT FAILED ==="
  exit 1
fi

echo "=== PREFLIGHT PASSED ==="
echo "Next: unset NODE_ENV && npm ci --include=dev && npm run build && pm2 restart midnight-epos"
