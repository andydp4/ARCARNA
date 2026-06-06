#!/usr/bin/env bash
# Verify production HTTP security headers (H1 / GAP-H1-01).
# Usage: bash scripts/verify-production-headers.sh [base_url]
# Default: https://viger.cloud/midnight/api/health
set -euo pipefail

URL="${1:-https://viger.cloud/midnight/api/health}"
HEALTH_BODY_URL="${URL%/api/health}/api/health"
METRICS_URL="${URL%/api/health}/api/health/metrics"

echo "=== MidnightEPOS production header check ==="
echo "URL: $URL"
echo

HEADERS="$(curl -fsSI "$URL" 2>&1)" || {
  echo "FAIL: Could not fetch $URL"
  exit 1
}

echo "$HEADERS" | head -20
echo

PASS=0
FAIL=0

if echo "$HEADERS" | grep -qi 'strict-transport-security'; then
  echo "OK: Strict-Transport-Security present"
  PASS=$((PASS + 1))
else
  echo "FAIL: Strict-Transport-Security missing — add to nginx HTTPS block (see deploy/nginx-viger.cloud.conf.example)"
  FAIL=$((FAIL + 1))
fi

if curl -fsS "$HEALTH_BODY_URL" | grep -q '"ok":true'; then
  echo "OK: Health body ok:true"
  PASS=$((PASS + 1))
else
  echo "FAIL: Health body missing ok:true"
  FAIL=$((FAIL + 1))
fi

if curl -fsS "$METRICS_URL" | grep -q '"outboxPending"'; then
  echo "OK: Metrics endpoint reachable (H3)"
  PASS=$((PASS + 1))
else
  echo "WARN: Metrics endpoint unavailable or DATABASE_URL unset on target"
fi

echo
if [ "$FAIL" -gt 0 ]; then
  echo "Result: $FAIL check(s) failed, $PASS passed"
  exit 1
fi

echo "Result: all required checks passed ($PASS)"
