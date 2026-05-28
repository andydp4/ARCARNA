# MidnightEPOS — Security review (living document)

This document tracks **high-level security posture** for MidnightEPOS. It complements `ARCHITECTURE.md` (system shape) and `RBAC.md` (roles). Update it when auth, tenancy, or exposure boundaries change.

## Threat model (retail EPOS)

| Concern | Mitigation in codebase |
|--------|-------------------------|
| **Cross-tenant data access** | Org-scoped storage and `X-Org-Id` / `requireOrgScope` on tenant APIs (`server/routes.ts`, `server/storage.ts`). |
| **Session hijack / credential theft** | Clerk-hosted auth; HTTP-only cookies where Passport/Replit path is used; prefer HTTPS in production. |
| **Brute force / scraping** | Rate limiting on `/api/*` when enabled (`server/index.ts` — align with deployed `main`). Helmet security headers in production. |
| **Super-admin blast radius** | **Clerk two-factor required** for `SUPER_ADMIN` on sensitive routes (`server/auth/superAdminMfa.ts`). Replit provider skips MFA (legacy); prefer Clerk in production. |
| **Repudiation / forensics** | Append-only **`admin_audit_logs`** for access-control and org-create actions; UI at **Audit log** (`/audit-logs`). |

## Super-admin MFA (S7)

- **Clerk:** `requireSuperAdminMfa` calls Clerk’s `twoFactorEnabled`. If false, API returns `403` with `code: "MFA_REQUIRED"`.
- **Replit / `AUTH_PROVIDER=replit`:** Middleware does **not** block (no Clerk MFA signal). Document upgrade path: migrate to Clerk and enforce MFA for break-glass accounts.
- **Dev:** `DEV_AUTH_BYPASS=1` skips MFA (local only).

## Operational checklist

1. Production: `NODE_ENV=production`, HTTPS, `DATABASE_URL` with least privilege.
2. Clerk: enforce MFA for all org admins where possible; at minimum for users with `SUPER_ADMIN`.
3. Run SQL migrations including `migrations/011_admin_audit_logs.sql` before relying on audit UI.
4. Review **Audit log** after access changes or incidents.
5. API keys / channel webhooks (C-phase): rotate keys on compromise; scope keys to minimum (`scopes`); monitor webhook delivery failures (future dashboards).

## Related files

- `server/auth/superAdminMfa.ts` — MFA gate  
- `server/adminAudit.ts` — audit writer  
- `shared/schema.ts` — `adminAuditLogs` table  
- `docs/CHANNEL_INGEST.md` — external ingest adapter (C5)
