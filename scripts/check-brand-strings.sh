#!/usr/bin/env bash
# Fail CI if user-facing "Midnight" brand strings reappear in UI surfaces.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PATTERN='Midnight EPOS|Midnight epos|Midnight Retail'
EXCLUDE='shared/brand.ts|REBRAND_ARCARNA|legacy|migration|midnight-epos-db|midnight\.|/midnight'

hits=$(rg -i "$PATTERN" client/ portal/index.html server/templates/ \
  --glob '!**/*.test.*' \
  -g '!**/sw.js' \
  2>/dev/null || true)

if [ -n "$hits" ]; then
  echo "FAIL: user-facing Midnight brand strings found:"
  echo "$hits"
  exit 1
fi

echo "OK: no user-facing Midnight brand strings in client/ portal/ server/templates"
