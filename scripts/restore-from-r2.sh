#!/usr/bin/env bash
# M4 — download a dump from R2 and pg_restore into TARGET_DATABASE_URL.
set -euo pipefail

usage() {
  echo "Usage: $0 [latest|YYYY-MM-DD|YYYY-MM-DD-HHMMSS] [target_database_url]"
  echo "  TARGET_DATABASE_URL env var used when target URL arg omitted."
  exit 1
}

[[ $# -lt 1 ]] && usage

SELECTION="${1:-latest}"
TARGET="${2:-${TARGET_DATABASE_URL:-}}"
: "${TARGET:?TARGET_DATABASE_URL or second argument required}"
: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID is required}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY is required}"
: "${R2_BUCKET:?R2_BUCKET is required}"
: "${R2_ENDPOINT:?R2_ENDPOINT is required}"

export AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}"
export AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}"
export AWS_DEFAULT_REGION="${R2_REGION:-auto}"

aws_cli() {
  aws --endpoint-url "${R2_ENDPOINT}" s3 "$@"
}

if [[ "${SELECTION}" == "latest" ]]; then
  OBJECT_KEY="$(aws_cli ls "s3://${R2_BUCKET}/backups/" | sort | tail -n 1 | awk '{print $4}')"
else
  MATCH="$(aws_cli ls "s3://${R2_BUCKET}/backups/" | awk '{print $4}' | grep "midnight-${SELECTION}" | sort | tail -n 1)"
  OBJECT_KEY="${MATCH}"
fi

[[ -z "${OBJECT_KEY}" ]] && { echo "No backup found for: ${SELECTION}"; exit 1; }

LOCAL="/tmp/restore-${OBJECT_KEY##*/}"
echo "[restore] Downloading s3://${R2_BUCKET}/${OBJECT_KEY}"
aws_cli cp "s3://${R2_BUCKET}/${OBJECT_KEY}" "${LOCAL}"

echo "[restore] Restoring into target database"
pg_restore --clean --if-exists --no-owner --dbname="${TARGET}" "${LOCAL}"

rm -f "${LOCAL}"
echo "[restore] Done"
