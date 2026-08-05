#!/usr/bin/env bash
# ARCARNA EPOS production deploy (PM2 + Nginx on Hostinger VPS)
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== ARCARNA EPOS production deploy ==="

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

echo "=== npm ci (lockfile-exact) ==="
# `npm install` MUTATES whatever tree is already on the box — a production
# deploy once reported "added 16, removed 62, changed 17 packages", so the
# built artifact did not match the committed lockfile (a local `npm ci` at the
# same commit produced a 390kB entry chunk; this box produced 649kB).
# `npm ci` installs the lockfile exactly and fails loudly if package.json and
# package-lock.json have drifted apart, which is what a deploy should do.
npm ci

echo "=== build ==="
npm run build

# Backstop for the sourcemap leak. vite.config.ts builds with
# `sourcemap: "hidden"` whenever SENTRY_AUTH_TOKEN is set, which writes .map
# files into dist/public — the directory the server hosts statically. Its
# `filesToDeleteAfterUpload` clears them, and that was verified to hold even
# when the upload 401s on a stale token, which is the case that stranded them
# in production on 6a020e3.
#
# This sweep exists because that guarantee lives in a plugin option someone
# could reasonably delete while tidying, and the failure is silent and
# security-relevant. Nothing references these files (no sourceMappingURL
# comment is emitted), so removing any that survive is always safe.
STRAY_MAPS="$(find dist/public -name '*.map' -type f 2>/dev/null | wc -l)"
if [[ "$STRAY_MAPS" -gt 0 ]]; then
  echo "  removing $STRAY_MAPS sourcemap(s) left in dist/public (upload failed or was skipped)"
  find dist/public -name '*.map' -type f -delete
fi

echo "=== PM2 (re)start with fresh .env ==="
# pm2 restart/reload (even with --update-env) keeps the env captured when the
# process was first created. This app has NO dotenv fallback — PM2's env_file is
# the only thing that loads .env into process.env — so a changed secret (e.g.
# CLERK_SECRET_KEY) is silently ignored and the old value keeps running.
# Delete + start re-reads ecosystem.config.cjs's env_file, guaranteeing the
# current .env is loaded. (Verify after: tr '\0' '\n' < /proc/$(pm2 pid arcarna-epos)/environ | grep CLERK_)
if pm2 describe arcarna-epos >/dev/null 2>&1; then
  pm2 delete arcarna-epos
fi
pm2 start ecosystem.config.cjs
pm2 save

echo "=== health check ==="
sleep 4
HEALTH_PATH="${APP_BASE_PATH:-/arcarna}/api/health"
if curl -sf "http://127.0.0.1:5000${HEALTH_PATH}" >/dev/null; then
  curl -s "http://127.0.0.1:5000${HEALTH_PATH}"
  echo ""
  echo "OK: App is responding."
else
  echo "NOT READY: /api/health failed"
  echo "--- pm2 status ---"
  pm2 status arcarna-epos || true
  echo "--- last 30 log lines ---"
  pm2 logs arcarna-epos --lines 30 --nostream || true
  echo ""
  echo "Common fixes:"
  echo "  1. Add to .env: CLERK_ACCOUNTS_URL=https://accounts.viger.cloud"
  echo "  2. pm2 delete arcarna-epos && pm2 start ecosystem.config.cjs && pm2 save  (forces fresh .env read)"
  exit 1
fi

echo "SUCCESS: Deploy finished."
