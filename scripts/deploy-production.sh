#!/usr/bin/env bash
# MidnightEPOS production deploy (PM2 + Nginx on Hostinger VPS)
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== MidnightEPOS production deploy ==="

if [[ ! -f .env ]]; then
  echo "ERROR: Missing .env — copy .env.production.example and configure secrets."
  exit 1
fi

mkdir -p logs

echo "=== git pull ==="
git fetch origin
BRANCH="${DEPLOY_BRANCH:-main}"
git checkout "$BRANCH"
git pull origin "$BRANCH"
echo "On commit: $(git log -1 --oneline)"

echo "=== npm install ==="
npm install

echo "=== build ==="
npm run build

echo "=== PM2 restart ==="
if pm2 describe midnight-epos >/dev/null 2>&1; then
  pm2 restart ecosystem.config.cjs --update-env
else
  pm2 start ecosystem.config.cjs
fi
pm2 save

echo "=== health check ==="
sleep 4
if curl -sf "http://127.0.0.1:5000/api/health" >/dev/null; then
  curl -s "http://127.0.0.1:5000/api/health"
  echo ""
  echo "OK: App is responding."
else
  echo "NOT READY: /api/health failed"
  echo "--- pm2 status ---"
  pm2 status midnight-epos || true
  echo "--- last 30 log lines ---"
  pm2 logs midnight-epos --lines 30 --nostream || true
  echo ""
  echo "Common fixes:"
  echo "  1. Add to .env: CLERK_ACCOUNTS_URL=https://accounts.viger.cloud"
  echo "  2. pm2 restart ecosystem.config.cjs --update-env"
  exit 1
fi

echo "SUCCESS: Deploy finished."
