# Phase 2E: Regression + Release Readiness Gates

## Overview

Phase 2E converts Phase 2D checks into repeatable release gates and CI.

## Security Lockdown (Required Adjustments)

### Test-mode impersonation

`X-Test-Replit-User-Id` impersonation is allowed **only** when all of the following are true:

- `PHASE2D_TEST=1`
- `NODE_ENV !== 'production'`
- Request from localhost (`127.0.0.1` / `::1`)
- `X-Test-Secret` header matches `PHASE2D_TEST_SECRET` env var

If any condition fails, the header is ignored. **Never enabled in production.**

### Forced worker failure

`BusinessInsightsWorker` throws intentionally **only** when:

- `PHASE2D_TEST=1`
- `NODE_ENV !== 'production'`
- Payload has `_phase2dForceFail: true`

**Never triggers in production.**

## Release Gate Command

```bash
npm run gate
```

Runs, in order:

1. **npm run check** – TypeScript compilation
2. **Phase 2D seed** – Multi-org test data (if `DATABASE_URL` set)
3. **Phase 2D tests** – Storage, analytics, workers, dead letter (if `DATABASE_URL` set)

If `DATABASE_URL` is not set, steps 2–3 are skipped; the gate passes if the TypeScript check succeeds.

**Failure:** Exits non-zero and prints a readable summary.

**Assumptions:**

- When `DATABASE_URL` is set, it points to a test or disposable database (Phase 2D seed creates and modifies data).
- For local runs without a DB, the gate runs check-only.

## CI (GitHub Actions)

Workflow: `.github/workflows/ci.yml`

- **check job:** Always runs `npm run check`.
- **gate job:** Runs `npm run gate` against a PostgreSQL 16 service container.

No secrets required; the Postgres service supplies `DATABASE_URL`.

## Scripts Are Validation-Only

Phase 2D scripts (`phase2d-seed.ts`, `phase2d-test.ts`, `release-gate.ts`) are for validation only. They:

- Do not run on install, build, or dev
- Live under `scripts/`
- Are invoked only when explicitly run

## Phase 2F Additions

- **Impersonation:** Now requires BOTH localhost AND `X-Test-Secret` matching `PHASE2D_TEST_SECRET` (belt + braces).
- **Production hooks check:** `npm run gate` runs `assert-production-hooks-off.ts` with `NODE_ENV=production`; exit 1 if hooks fire.
- **Migration sanity:** `npm run migration:sanity` detects old analytics PK and org count; prints migration instructions.
- **Release checklist:** `docs/RELEASE_CHECKLIST.md`.
