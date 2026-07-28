#!/usr/bin/env bash
set -euo pipefail
echo "[Agent] Installing workspace deps..."
npm i
echo "[Agent] Building domain package..."
npm -w @midnight/domain run build
echo "[Agent] Running integration tests (in-memory mode)..."
# Tests and server wiring default to in-memory when DATABASE_URL is absent.
npm -w @midnight/server run test:integration
echo "[Agent] Naming guard..."
bash ./scripts/guard-naming.sh || true