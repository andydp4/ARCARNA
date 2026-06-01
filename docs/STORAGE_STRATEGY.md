# Object storage strategy (Files / Backups)

Written ahead of the **Viger portal** Files and Backups UX (`portal/`). Defines how MidnightEPOS will use object storage so tenant uploads, exports, and platform backups stay isolated and operable.

## Provider choice

| Option | Decision |
|--------|----------|
| **Cloudflare R2** | **Default** for production — already used for Neon logical dumps ([DISASTER_RECOVERY.md](./DISASTER_RECOVERY.md)); S3-compatible API; no egress fees to Cloudflare edge. |
| **AWS S3** | Acceptable alternative; same key layout and IAM-style prefixes. Use one provider per environment to avoid split-brain. |

Application code should talk to storage through a thin S3-compatible client (`@aws-sdk/client-s3` or `aws cli`) with `endpoint`, `region`, and path-style settings from env — same pattern as `scripts/backup-neon-to-r2.sh`.

## Bucket layout

Use **one bucket per environment** (e.g. `midnight-backups-prod`). Separate **platform** paths from **tenant** paths.

```
s3://{bucket}/
  backups/                          # Platform — M4 Neon pg_dump (existing)
    midnight-YYYY-MM-DD-HHMMSS.dump

  platform/                         # Future: shared assets, migration artifacts (optional)

  orgs/{orgId}/                     # Tenant-scoped (future Files API)
    uploads/                        # User uploads (images, attachments)
      {uploadId}/{filename}
    exports/                        # Generated CSV/PDF exports (time-limited)
      {exportId}/{filename}
```

**Rules:**

- Every tenant object key **must** start with `orgs/{orgId}/` so lifecycle and IAM policies can scope by prefix.
- **Never** store database dumps under `orgs/` — dumps stay under `backups/` only.
- `orgId` is the internal UUID from `organizations.id`, not slug or display name.

## Platform backups vs user uploads

| Class | Path | Writer | Retention | Notes |
|-------|------|--------|-----------|-------|
| **DB backup** | `backups/midnight-*.dump` | Cron / `scripts/backup-neon-to-r2.sh` | 30 days (`BACKUP_RETENTION_DAYS`) | Operational; restore via [DISASTER_RECOVERY.md](./DISASTER_RECOVERY.md) |
| **User upload** | `orgs/{orgId}/uploads/...` | Future Files API | TBD per org tier; default 2 years | Product images, contact import attachments |
| **Export** | `orgs/{orgId}/exports/...` | Future report/export jobs | 7–90 days (signed URL) | Ephemeral; delete after download window |

Backups contain **full database** snapshots (PII). User uploads contain **only what tenants upload**. Do not mix retention policies or backup scripts into the uploads prefix.

## Upload constraints (future Files API)

When the portal upload API ships, enforce at the edge and in app code:

| Control | Planned value |
|---------|----------------|
| **Max object size** | 25 MB per file (align with Nginx `client_max_body_size` and import routes — see [DEPLOY_HOSTINGER_VPS.md](./DEPLOY_HOSTINGER_VPS.md)) |
| **MIME allowlist** | `image/jpeg`, `image/png`, `image/webp`, `application/pdf`, `text/csv`, `text/vcard`, `application/vnd.ms-excel` (review when product import expands) |
| **Rate limits** | Defer dedicated upload limiters until routes exist; follow tiered `/api` pattern from H1 ([PHASE_HARDENING.md](./briefs/PHASE_HARDENING.md)) |
| **Auth** | Clerk session + `requireOrgScope`; presigned PUT only after server validates org + quota |

## Virus / malware scanning (future)

- **Hook point:** After upload completes to R2, enqueue a job (event outbox) to scan before marking file `available`.
- **Not in scope for Wave 0:** No scanner integration yet; block executable MIME types at upload and serve downloads with `Content-Disposition: attachment` where appropriate.

## Retention and compliance

| Data type | Retention |
|-----------|-----------|
| DB dumps | 30 days in R2 (see disaster recovery doc) |
| Admin audit logs | **7 years** in Postgres — see [SECURITY_REVIEW.md](./SECURITY_REVIEW.md) |
| User uploads | Policy per org; archive to cold storage only after explicit product decision |

Exports should use **short-lived presigned GET** URLs (≤ 1 hour). Deletes are soft-delete in DB + async object delete for GDPR-style requests (future brief).

## Environment variables

Reuse R2 credentials for tenant objects **or** use a second bucket with the same account:

| Variable | Purpose |
|----------|---------|
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | S3 API auth |
| `R2_BUCKET` | Bucket name |
| `R2_ENDPOINT` / `R2_REGION` | S3 client config |

Optional future: `FILES_BUCKET`, `FILES_MAX_BYTES`, `FILES_ALLOWED_MIMES` when Files API is implemented.

## Implementation status

| Capability | Status |
|------------|--------|
| Neon → R2 nightly backup | **Shipped** (M4) |
| Portal Files / Backups UI | Placeholder |
| Presigned upload/download API | Not built |
| Org-prefixed object keys in app | **Documented here** |

## See also

- [DISASTER_RECOVERY.md](./DISASTER_RECOVERY.md) — backup and restore drill
- [ARCHITECTURE_DOMAIN_MAP.md](./ARCHITECTURE_DOMAIN_MAP.md) — Viger portal classification
- [CHANNEL_INGEST.md](./CHANNEL_INGEST.md) — API keys and webhooks (not object storage)
