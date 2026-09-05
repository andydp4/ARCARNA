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
BRANCH="${DEPLOY_BRANCH:-main}"

# A deploy that quietly discards someone's hotfix is worse than one that stops.
if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: This checkout has uncommitted changes. Commit, stash or discard"
  echo "them before deploying — the branch reset below would throw them away."
  git status --short
  exit 1
fi

# Fetch the branch by name rather than trusting the clone's refspec.
# `git clone --branch X --single-branch` pins remote.origin.fetch to X alone, so
# a plain `git fetch origin` never produces origin/main and `git checkout main`
# dies with "pathspec 'main' did not match any file(s) known to git" — an error
# that says nothing about the cause and stopped a website deploy dead. Naming
# the branch works on either shape of clone, and resetting to what was just
# fetched makes the deployed commit exactly the remote's, whatever the local
# branch was pointing at.
git fetch origin "$BRANCH"
git checkout -B "$BRANCH" FETCH_HEAD
echo "On commit: $(git log -1 --oneline)"

echo "=== npm install (including build tools) ==="
npm install --include=dev

echo "=== build for wmsupplies.co.uk ==="
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
