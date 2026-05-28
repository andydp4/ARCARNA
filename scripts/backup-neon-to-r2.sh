#!/usr/bin/env bash
# M4 — nightly Neon pg_dump → Cloudflare R2 (S3-compatible API).
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID is required}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY is required}"
: "${R2_BUCKET:?R2_BUCKET is required}"
: "${R2_ENDPOINT:?R2_ENDPOINT is required}"

RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
STAMP="$(date -u +%Y-%m-%d-%H%M%S)"
DUMP_PATH="/tmp/midnight-${STAMP}.dump"
OBJECT_KEY="backups/midnight-${STAMP}.dump"

export AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}"
export AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}"
export AWS_DEFAULT_REGION="${R2_REGION:-auto}"

aws_cli() {
  aws --endpoint-url "${R2_ENDPOINT}" s3 "$@"
}

echo "[backup] Starting pg_dump → ${OBJECT_KEY}"
pg_dump "${DATABASE_URL}" --no-owner --no-privileges --format=custom -f "${DUMP_PATH}"

echo "[backup] Uploading to s3://${R2_BUCKET}/${OBJECT_KEY}"
aws_cli cp "${DUMP_PATH}" "s3://${R2_BUCKET}/${OBJECT_KEY}"

rm -f "${DUMP_PATH}"

echo "[backup] Rotating objects older than ${RETENTION_DAYS} days"
CUTOFF_EPOCH="$(date -u -v-"${RETENTION_DAYS}"d +%s 2>/dev/null || date -u -d "${RETENTION_DAYS} days ago" +%s)"
while IFS= read -r line; do
  [[ -z "${line}" ]] && continue
  key="$(echo "${line}" | awk '{print $4}')"
  ts="$(echo "${line}" | awk '{print $1" "$2}')"
  file_epoch="$(date -u -j -f "%Y-%m-%d %H:%M:%S" "${ts}" +%s 2>/dev/null || date -u -d "${ts}" +%s)"
  if [[ "${file_epoch}" -lt "${CUTOFF_EPOCH}" ]]; then
    echo "[backup] Deleting stale object ${key}"
    aws_cli rm "s3://${R2_BUCKET}/${key}"
  fi
done < <(aws_cli ls "s3://${R2_BUCKET}/backups/" || true)

if [[ -n "${BACKUP_NOTIFY_WEBHOOK:-}" ]]; then
  curl -fsS -X POST -H "Content-Type: application/json" \
    -d "{\"text\":\"Midnight backup OK: ${OBJECT_KEY}\"}" \
    "${BACKUP_NOTIFY_WEBHOOK}" || true
fi

echo "[backup] Done"
