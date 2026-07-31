#!/usr/bin/env bash
# Build and publish the Viger Cloud corporate website to the nginx web root.
# Usage:  ./deploy.sh [DEST]   (DEST defaults to /var/www/viger.cloud)
#
# Prerequisites: Node 20+, npm ci, .env sourced if using analytics/forms.
set -euo pipefail
cd "$(dirname "$0")"

DEST="${1:-/var/www/viger.cloud}"

echo "=== Building Viger Cloud website ==="
npm ci
npm run build

echo "=== Publishing -> $DEST ==="
sudo mkdir -p "$DEST"
sudo rsync -a --delete dist/ "$DEST"/

# nginx (www-data) must be able to read the files.
sudo chmod -R a+rX "$DEST"

echo "OK: website published to $DEST"
echo "Reload nginx if the site config changed:  sudo nginx -t && sudo systemctl reload nginx"
