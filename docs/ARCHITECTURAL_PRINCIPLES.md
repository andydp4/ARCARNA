# Architectural Principles

This document is the **repo constitution** for MidnightEPOS. Every change to server routes, storage, schema, workers, or cross-cutting client infrastructure should honour these principles.

**PRs that violate a principle** must include an explicit `## Principle Exception` section in the PR description explaining why, which principle is waived, and who approved the exception.

---

## Principles

1. **Single deployable app** — Prefer a modular monolith over microservices until there is proven need to split processes.

2. **One schema source of truth** — [`shared/schema.ts`](../shared/schema.ts) is the canonical Drizzle schema and Zod types. Do not maintain parallel schema definitions for production tables.

3. **Tenant scoping** — All tenant data queries include `orgId` (except documented SUPER_ADMIN global reads).

4. **Transactional outbox** — Side effects go through the event outbox (`event_outbox`). **Business writes and outbox inserts must run in the same database transaction** for critical paths (orders, refunds, stock adjustments that emit events).

5. **Idempotent workers** — Workers must be safe to retry. Document the idempotency key per worker (typically `eventId`, sometimes `correlationId` + business key).

6. **Thin routes** — Route handlers do auth, validation, and delegation only. Domain logic lives in `server/services/` or `shared/`.

7. **No client database access** — The browser never talks to Postgres directly. No secrets in the client bundle.

8. **One auth provider** — Only one `AUTH_PROVIDER` is active per environment (currently Clerk in production).

9. **Never `db:push` on production** — Production schema changes use ordered SQL migrations applied via `scripts/apply-migrations-pm2.sh`. See [SCHEMA_EVOLUTION.md](./SCHEMA_EVOLUTION.md).

10. **Explicit types** — Prefer explicit TypeScript types over `any` on new code.

11. **Experimental features behind flags** — Do not register workers in `REQUIRED_WORKERS` until a feature is promoted from Experimental to Supporting/Core in [ARCHITECTURE_DOMAIN_MAP.md](./ARCHITECTURE_DOMAIN_MAP.md).

12. **Import safety** — Large imports are parsed client-side where practical; the server enforces `IMPORT_MAX_ROWS`, org scope, and preview-before-commit.

13. **Base path** — The EPOS app lives at `/midnight`; the Viger portal lives at `/`. API and static assets must remain base-path aware.

14. **External order ingest** — Orders from web, WhatsApp, phone, or the public API must go through the same `engine.placeOrder` code path. No channel may write to the `orders` table directly.

15. **Reserved schema** — Table/column shapes listed as **Reserved** in [SCHEMA_EVOLUTION.md](./SCHEMA_EVOLUTION.md) are off-limits to feature PRs until promoted to **Applied**.

16. **Required `orgId` on storage** — All `storage.*` methods that return rows from org-scoped tables must take a **required** `orgId` parameter. Cross-tenant admin reads use explicitly named `adminGetAllX()` methods.

---

## See also

- [ARCHITECTURE_DOMAIN_MAP.md](./ARCHITECTURE_DOMAIN_MAP.md) — Core vs Supporting vs Experimental
- [SCHEMA_EVOLUTION.md](./SCHEMA_EVOLUTION.md) — Migrations and reserved DDL
- [../ARCHITECTURE.md](../ARCHITECTURE.md) — Runtime layout and entry points
