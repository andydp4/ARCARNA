# MidnightEPOS — Security review (living document)

This document tracks **high-level security posture** for MidnightEPOS. It complements `ARCHITECTURE.md` (system shape) and `RBAC.md` (roles). Update it when auth, tenancy, or exposure boundaries change.

## Threat model (retail EPOS)

| Concern | Mitigation in codebase |
|--------|-------------------------|
| **Cross-tenant data access** | Org-scoped storage and `X-Org-Id` / `requireOrgScope` on tenant APIs (`server/routes.ts`, `server/storage.ts`). |
| **Session hijack / credential theft** | Clerk-hosted auth; HTTP-only cookies where Passport/Replit path is used; prefer HTTPS in production. |
| **Brute force / scraping** | Tiered rate limits in `server/security.ts`: global `/api/*` (800 / 15 min prod), `/api/auth/*` (20 / min), `/api/*/import*` (5 / min). Helmet security headers in production (CSP disabled — Clerk-safe). HSTS at nginx edge (see deploy doc). |
| **Super-admin blast radius** | **Clerk two-factor required** for `SUPER_ADMIN` on sensitive routes (`server/auth/superAdminMfa.ts`). Replit provider skips MFA (legacy); prefer Clerk in production. |
| **Repudiation / forensics** | Append-only **`admin_audit_logs`** for access-control and org-create actions; UI at **Audit log** (`/audit-logs`). |

## Admin audit retention (S7 / H2)

- **Policy:** `admin_audit_logs` rows are **append-only** and retained for **7 years** from `created_at` to satisfy retail/compliance forensics (access changes, org creation, bulk admin actions).
- **Storage:** Primary store is Postgres (Neon). Optional column `retention_until` (migration `014_admin_audit_retention.sql`) records the not-before-delete date; **no automated purge** runs in application code yet.
- **Export / archival:** For long-term compliance beyond Neon PITR, export audit rows periodically (e.g. CSV to encrypted object storage under a platform prefix — see [STORAGE_STRATEGY.md](./STORAGE_STRATEGY.md)). Cold archival to separate storage is an future ops task (out of H2 scope).
- **After incidents:** Review **Audit log** during and after the window; pair with [ops/INCIDENT_CHECKLIST.md](./ops/INCIDENT_CHECKLIST.md).

## Secret rotation

Credential rotation (Clerk, `DATABASE_URL`, `SESSION_SECRET`, R2, webhooks, API keys) is documented in **[SECRET_ROTATION_RUNBOOK.md](./SECRET_ROTATION_RUNBOOK.md)**. Rotate immediately if credentials appear in chat, git, or public logs.

## Super-admin MFA (S7)

- **Clerk:** `requireSuperAdminMfa` calls Clerk’s `twoFactorEnabled`. If false, API returns `403` with `code: "MFA_REQUIRED"`.
- **Replit / `AUTH_PROVIDER=replit`:** Middleware does **not** block (no Clerk MFA signal). Document upgrade path: migrate to Clerk and enforce MFA for break-glass accounts.
- **Dev:** `DEV_AUTH_BYPASS=1` skips MFA (local only).

## Operational checklist

1. Production: `NODE_ENV=production`, HTTPS, `DATABASE_URL` with least privilege.
2. Clerk: enforce MFA for all org admins where possible; at minimum for users with `SUPER_ADMIN`.
3. Run SQL migrations including `migrations/011_admin_audit_logs.sql` and `migrations/014_admin_audit_retention.sql` before relying on audit UI retention metadata.
4. Review **Audit log** after access changes or incidents ([ops/INCIDENT_CHECKLIST.md](./ops/INCIDENT_CHECKLIST.md)).
5. API keys / channel webhooks (C-phase): rotate keys on compromise; scope keys to minimum (`scopes`); monitor webhook delivery failures (future dashboards). See [SECRET_ROTATION_RUNBOOK.md](./SECRET_ROTATION_RUNBOOK.md).
6. **Observability:** Ship `SENTRY_DSN` in production for server exceptions; scrape `GET /api/health/metrics` (public — no auth; suitable for uptime monitors). Fields when `DATABASE_URL` is set: `outboxPending`, `outboxDispatched`, `deadLetterCount`, `oldestPendingSeconds`, `jobQueued`. Suggested alert thresholds (tune per environment): `outboxPending` > 100, `oldestPendingSeconds` > 300, `deadLetterCount` increasing, `jobQueued` > 500.

## Related files

- `server/security.ts` — Helmet + tiered rate limits (H1)
- `server/auth/superAdminMfa.ts` — MFA gate  
- `server/adminAudit.ts` — audit writer  
- `shared/schema.ts` — `adminAuditLogs` table  
- `migrations/011_admin_audit_logs.sql`, `migrations/014_admin_audit_retention.sql` — audit table and retention column  
- [SECRET_ROTATION_RUNBOOK.md](./SECRET_ROTATION_RUNBOOK.md) — operator rotation procedures  
- [ops/INCIDENT_CHECKLIST.md](./ops/INCIDENT_CHECKLIST.md) — production incident triage  
- [STORAGE_STRATEGY.md](./STORAGE_STRATEGY.md) — object storage and backup vs uploads  
- `docs/CHANNEL_INGEST.md` — external ingest adapter (C5)
