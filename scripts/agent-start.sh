#!/usr/bin/env bash
set -euo pipefail
echo "[Agent] Installing workspace deps..."
npm i
echo "[Agent] Building domain package..."
npm -w @midnight/domain run build
echo "[Agent] Starting server in IN-MEMORY mode (no DATABASE_URL set)..."
# The server wiring will auto-switch to in-memory repos when no DATABASE_URL is present.
npm -w @midnight/server run dev