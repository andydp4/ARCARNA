#!/usr/bin/env bash
# WM Supplies customer website deploy (PM2 + Nginx on the same VPS as Arcana)
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== WM Supplies website deploy ==="

if [[ ! -f .env ]]; then
  echo "ERROR: Missing .env — copy .env.wm-supplies.example and configure secrets."
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

echo "=== build for wmsupplies.com ==="
set -a
source .env
set +a
npm run build

echo "=== PM2 (re)start with fresh .env ==="
if pm2 describe wm-supplies-website >/dev/null 2>&1; then
  pm2 delete wm-supplies-website
fi
pm2 start ecosystem.wm-supplies.config.cjs
pm2 save

echo "=== health check ==="
sleep 4
if curl -sf "http://127.0.0.1:${PORT:-5001}/api/health" >/dev/null; then
  curl -s "http://127.0.0.1:${PORT:-5001}/api/health"
  echo ""
  echo "OK: WM Supplies website process is responding."
else
  echo "NOT READY: /api/health failed"
  echo "--- pm2 status ---"
  pm2 status wm-supplies-website || true
  echo "--- last 30 log lines ---"
  pm2 logs wm-supplies-website --lines 30 --nostream || true
  exit 1
fi

echo "SUCCESS: Deploy finished."
