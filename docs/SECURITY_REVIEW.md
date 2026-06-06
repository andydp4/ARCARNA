# MidnightEPOS — Security review (living document)

This document tracks **high-level security posture** for MidnightEPOS. It complements `ARCHITECTURE.md` (system shape) and `RBAC.md` (roles). Update it when auth, tenancy, or exposure boundaries change.

## Threat model (retail EPOS)

| Concern | Mitigation in codebase |
|--------|-------------------------|
| **Cross-tenant data access** | Org-scoped storage and `X-Org-Id` / `requireOrgScope` on tenant APIs (`server/routes.ts`, `server/storage.ts`). |
| **Session hijack / credential theft** | Clerk-hosted auth; HTTP-only cookies where Passport/Replit path is used; prefer HTTPS in production. |
| **Brute force / scraping** | Tiered rate limits in `server/security.ts`: global `/api/*` (800 / 15 min prod), `/api/auth/*` (20 / min), `/api/*/import*` (5 / min). Helmet security headers in production (CSP disabled — see § CSP below). HSTS at nginx edge (see deploy doc). |
| **Super-admin blast radius** | **Clerk two-factor required** for `SUPER_ADMIN` on sensitive routes (`server/auth/superAdminMfa.ts`). Replit provider skips MFA (legacy); prefer Clerk in production. |
| **Repudiation / forensics** | Append-only **`admin_audit_logs`** for access-control and org-create actions; UI at **Audit log** (`/audit-logs`). |

## Admin audit retention (S7 / H2)

- **Policy:** `admin_audit_logs` rows are **append-only** and retained for **7 years** from `created_at` to satisfy retail/compliance forensics (access changes, org creation, bulk admin actions).
- **Storage:** Primary store is Postgres (Neon). Optional column `retention_until` (migration `014_admin_audit_retention.sql`) records the not-before-delete date; **no automated purge** runs in application code yet.
- **Export / archival:** For long-term compliance beyond Neon PITR, export audit rows periodically (e.g. CSV to encrypted object storage under a platform prefix — see [STORAGE_STRATEGY.md](./STORAGE_STRATEGY.md)). Cold archival to separate storage is an future ops task (out of H2 scope).
- **After incidents:** Review **Audit log** during and after the window; pair with [ops/INCIDENT_CHECKLIST.md](./ops/INCIDENT_CHECKLIST.md).

## Content-Security-Policy (H1 / GAP-H1-02 sign-off)

**Decision (accepted risk):** Helmet `contentSecurityPolicy` is **disabled** in `server/security.ts` (`contentSecurityPolicy: false`).

**Rationale:**

- Vite production builds inject inline bootstrap scripts into `index.html`.
- Clerk sign-in loads scripts and iframes from `accounts.viger.cloud` and Clerk CDN domains.
- Enabling strict Node CSP without `'unsafe-inline'` breaks the SPA boot; enabling it with `'unsafe-inline'` provides limited XSS benefit.

**Mitigations in place:**

- HSTS at nginx edge (forces HTTPS).
- Helmet defaults still apply (`X-Content-Type-Options`, `X-Frame-Options`, etc.) in production.
- Tiered rate limits on auth and import routes.
- Clerk-hosted auth; no custom password forms in-app.

**Future tighten (optional):** nginx-only CSP for static assets under `/midnight/assets/*` — re-test `/midnight/sign-in` after any change. See [DEPLOY_HOSTINGER_VPS.md](./DEPLOY_HOSTINGER_VPS.md) § HTTP security headers.

**Signed off:** 2026-06-05 — documented accepted risk; no Node CSP until Clerk+Vite boot path supports nonce/hash CSP.

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
6. **Observability:** Optional Sentry — no-op when DSN unset. **Server:** `SENTRY_DSN`, optional `SENTRY_TRACES_SAMPLE_RATE` (runtime). **Client:** `VITE_SENTRY_DSN`, optional `VITE_SENTRY_TRACES_SAMPLE_RATE` (baked in at `npm run build`). Scrape `GET /api/health/metrics` (public — no auth; suitable for uptime monitors). Fields when `DATABASE_URL` is set: `outboxPending`, `outboxDispatched`, `deadLetterCount`, `oldestPendingSeconds`, `jobQueued`. Suggested alert thresholds (tune per environment): `outboxPending` > 100, `oldestPendingSeconds` > 300, `deadLetterCount` increasing, `jobQueued` > 500.

## Related files

- `server/security.ts` — Helmet + tiered rate limits (H1)
- `server/auth/superAdminMfa.ts` — MFA gate  
- `server/adminAudit.ts` — audit writer  
- `shared/schema.ts` — `adminAuditLogs` table  
- `migrations/011_admin_audit_logs.sql`, `migrations/014_admin_audit_retention.sql` — audit table and retention column  
- [SECRET_ROTATION_RUNBOOK.md](./SECRET_ROTATION_RUNBOOK.md) — operator rotation procedures  
- [ops/INCIDENT_CHECKLIST.md](./ops/INCIDENT_CHECKLIST.md) — production incident triage  
- [ops/UPTIME_MONITORING.md](./ops/UPTIME_MONITORING.md) — external uptime monitors (O1)  
- [ops/OPERATOR_CHECKLIST.md](./ops/OPERATOR_CHECKLIST.md) — Wave 0 VPS sign-off (O1–O3, H1 verify)  
- [STORAGE_STRATEGY.md](./STORAGE_STRATEGY.md) — object storage and backup vs uploads  
- `docs/CHANNEL_INGEST.md` — external ingest adapter (C5)
