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
sleep 2
if curl -sf "http://127.0.0.1:5000/api/health" >/dev/null; then
  curl -s "http://127.0.0.1:5000/api/health"
  echo ""
  echo "OK: App is responding."
else
  echo "NOT READY: /api/health failed — check: pm2 logs midnight-epos --lines 40"
  exit 1
fi

echo "SUCCESS: Deploy finished."
