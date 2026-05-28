# Disaster recovery

## Backup strategy

- **Primary:** Neon point-in-time recovery (PITR) for the production database.
- **Secondary:** Nightly logical dumps via [`scripts/backup-neon-to-r2.sh`](../scripts/backup-neon-to-r2.sh) to Cloudflare R2 (S3-compatible API).
- **Retention:** 30 days of dump objects under `s3://$R2_BUCKET/backups/` (configurable with `BACKUP_RETENTION_DAYS`).

Dumps use `pg_dump --format=custom` (PostgreSQL 16, matching Neon). Object keys: `backups/midnight-YYYY-MM-DD-HHMMSS.dump`.

## Environment

See [`.env.production.example`](../.env.production.example) for `R2_*` variables. The backup script also requires `DATABASE_URL`.

Optional: `BACKUP_NOTIFY_WEBHOOK` posts success to Slack or another webhook.

## Restore drill (run at least once per quarter)

1. Create a fresh Neon branch or empty database; set `TARGET_DATABASE_URL`.
2. List backups: `aws --endpoint-url $R2_ENDPOINT s3 ls s3://$R2_BUCKET/backups/`
3. Restore latest: `./scripts/restore-from-r2.sh latest`
4. Compare row counts (orders, products, customers) to production within ~1%.
5. Record duration, issues, and date below.

### Drill log

| Date | Operator | Backup used | Duration | Notes |
|------|----------|-------------|----------|-------|
| _pending_ | | | | |

## Cron

On the VPS, schedule via `scripts/cron.example` (02:15 UTC daily). Logs: `/var/log/midnight-backup.log`.

## See also

- [DEPLOY_HOSTINGER_VPS.md](./DEPLOY_HOSTINGER_VPS.md) — backup cron section
- [SCHEMA_EVOLUTION.md](./SCHEMA_EVOLUTION.md) — schema migrations after restore
