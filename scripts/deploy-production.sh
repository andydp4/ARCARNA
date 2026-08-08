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
#
# --include=dev is REQUIRED, not belt-and-braces. This build needs vite and
# esbuild, both devDependencies, and npm omits devDependencies entirely when
# NODE_ENV=production is in the environment. .env sets NODE_ENV=production for
# the running app, so any operator who sources .env before deploying — which the
# runbook tells them to do for DATABASE_URL — silently gets a production-only
# install and the build dies on `sh: 1: vite: not found`. It installed 893
# packages instead of 1176 and failed on exactly that.
#
# Forcing it here means the deploy behaves the same whether .env was sourced or
# not, rather than depending on the shape of the shell it was launched from.
# apply-migrations-pm2.sh already carries the same scar for tsx.
npm ci --include=dev

echo "=== build ==="
# NODE_ENV=production makes Vite refuse to honour the mode and warn; the build is
# production by default here. The app still runs as production — PM2 loads
# NODE_ENV from .env via env_file, independently of this shell.
NODE_ENV= npm run build

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
# Read APP_BASE_PATH from .env rather than from whatever this shell happens to
# have. PM2 loads .env into the app via env_file; this script never sourced it,
# so its base path was always the bash default. When the two disagreed the curl
# below hit a path matching no route, got the SPA shell, and still passed.
if [[ -f .env ]]; then
  APP_BASE_PATH="$(grep -E '^APP_BASE_PATH=' .env | tail -1 | cut -d= -f2- | tr -d '"'"'"'\r' || true)"
fi
HEALTH_PATH="${APP_BASE_PATH:-/arcarna}/api/health"

# Assert the API answered — not merely that SOMETHING returned 200.
#
# The old check was `curl -sf ... >/dev/null`, which succeeds on any 2xx. The SPA
# fallback answers unmatched paths with index.html and a 200, so a deploy where
# the API was entirely unreachable still printed "OK: App is responding" — with
# the whole HTML document above it, which is exactly what happened on 21dea8d.
# A health check that cannot fail is not a health check.
HEALTH_BODY="$(curl -s --max-time 10 "http://127.0.0.1:5000${HEALTH_PATH}" || true)"
if grep -q '"ok"' <<<"$HEALTH_BODY"; then
  echo "$HEALTH_BODY"
  echo ""
  echo "OK: App is responding."
elif grep -qi '<!doctype html' <<<"$HEALTH_BODY"; then
  echo "NOT READY: ${HEALTH_PATH} returned the SPA shell, not JSON."
  echo "  The app is serving pages but this path reaches no API route."
  echo "  Check APP_BASE_PATH in .env matches the path above:"
  echo "    grep APP_BASE_PATH .env"
  echo "    tr '\0' '\n' < /proc/\$(pm2 pid arcarna-epos)/environ | grep APP_BASE_PATH"
  exit 1
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
