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

echo "=== PM2 (re)start with fresh .env ==="
# pm2 restart/reload (even with --update-env) keeps the env captured when the
# process was first created. This app has NO dotenv fallback — PM2's env_file is
# the only thing that loads .env into process.env — so a changed secret (e.g.
# CLERK_SECRET_KEY) is silently ignored and the old value keeps running.
# Delete + start re-reads ecosystem.config.cjs's env_file, guaranteeing the
# current .env is loaded. (Verify after: tr '\0' '\n' < /proc/$(pm2 pid midnight-epos)/environ | grep CLERK_)
if pm2 describe midnight-epos >/dev/null 2>&1; then
  pm2 delete midnight-epos
fi
pm2 start ecosystem.config.cjs
pm2 save

echo "=== health check ==="
sleep 4
HEALTH_PATH="${APP_BASE_PATH:-/midnight}/api/health"
if curl -sf "http://127.0.0.1:5000${HEALTH_PATH}" >/dev/null; then
  curl -s "http://127.0.0.1:5000${HEALTH_PATH}"
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
  echo "  2. pm2 delete midnight-epos && pm2 start ecosystem.config.cjs && pm2 save  (forces fresh .env read)"
  exit 1
fi

echo "SUCCESS: Deploy finished."
