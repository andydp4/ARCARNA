# Phase 2D: Runtime Validation & Multi-Org Integrity – Test Summary

## Overview

Phase 2D adds runtime validation and multi-tenant isolation tests. No new features. No refactors. Only validation and bug fixing.

**Important:** These scripts are for **validation only** and are **not part of runtime**. They live under `scripts/` and do not run automatically on install, build, or dev. They must be invoked explicitly.

## Deliverables

### 1. Multi-Org Isolation Test Harness

**Script:** `scripts/phase2d-seed.ts`

- Creates Org A and Org B
- Creates one location per org
- Creates users:
  - **SUPER_ADMIN** (no implicit org)
  - **ADMIN** (Org A)
  - **MANAGER** (Org A)
  - **CASHIER** (Org A)
  - **CASHIER** (Org B)
- Creates at least one product, customer, and order per org
- All IDs generated; none hardcoded

**Run:** `npm run phase2d:seed`

### 2. Cross-Org Access Tests

**Storage layer:**
- Cashier (Org A) cannot fetch product from Org B by ID → `getProduct(id, orgAId)` returns `null` for Org B product
- Cashier (Org A) cannot delete Org B product → `deleteProduct(id, orgAId)` throws for Org B product

**API layer (requires `PHASE2D_TEST=1` and running server):**
- Manager cannot create locations (403)
- Manager cannot delete locations (403)
- SUPER_ADMIN without `X-Org-Id` or `?orgId=` receives 403
- SUPER_ADMIN with `X-Org-Id` sees only that org’s products
- Cashier A cannot fetch/update/delete Org B product (404)

**Test user impersonation:** When `PHASE2D_TEST=1`, `NODE_ENV !== 'production'`, request is from localhost, AND `X-Test-Secret` matches `PHASE2D_TEST_SECRET`, the `X-Test-Replit-User-Id` header loads the corresponding `allowed_users` entry. **Never enabled in production.**

### 3. Analytics Integrity

- `analytics_daily` rows are separated by `orgId`
- Same date can exist for multiple orgs (composite PK `org_id`, `date`)
- `getDailyRevenue(orgId)` returns org-scoped data only
- Inserts use `ON CONFLICT (org_id, date) DO UPDATE` to keep per-org aggregates

### 4. Worker Validation

- Triggers: `OrderCreated`, `OrderUpdated`, `ExpenseLogged`
- Jobs are created per worker via `dispatchPendingEvents`
- `worker_run_logs` include correct `correlationId`
- Org-scoped payloads (e.g. `orgId`) ensure no cross-org side effects
- Worker runner processes jobs with idempotency checks

### 5. Dead Letter Safety

- **Force-fail hook:** When `PHASE2D_TEST=1` and `NODE_ENV !== 'production'`, `BusinessInsightsWorker` throws if payload contains `_phase2dForceFail: true`. **Never triggers in production.**
- Test publishes an event with this flag and creates a job with `maxAttempts: 1`
- After processing, the job is moved to `dead_letters`
- Other workers continue to succeed; failure stays within the failing job

## How to Run

1. Set `DATABASE_URL` and run `npm run db:push`
2. Run `npm run phase2d:seed` and save the JSON output
3. For API tests, start the server: `PHASE2D_TEST=1 npm run dev`
4. Run tests (must be from localhost; set `PHASE2D_TEST_SECRET` and script sends `X-Test-Secret`):
   `PHASE2D_TEST=1 PHASE2D_TEST_SECRET=your-secret npx tsx scripts/phase2d-test.ts '<paste_seed_json>'`

For storage/analytics/worker tests only (no HTTP):

```bash
PHASE2D_TEST=1 npx tsx scripts/phase2d-test.ts --storage-only '<seed_json>'
```

## Acceptance Criteria

| Criterion | Status |
|----------|--------|
| All isolation tests pass | ✓ |
| No cross-org reads/writes possible | ✓ |
| Analytics separation verified | ✓ |
| Worker system operates per org | ✓ |
| No new TypeScript errors | ✓ |

## Files Modified

| File | Change |
|------|--------|
| `server/replitAuth.ts` | Phase2D test mode: `X-Test-Replit-User-Id` loads user from `allowed_users` |
| `server/workers/businessInsightsWorker.ts` | Test-only throw when `PHASE2D_TEST=1` and `_phase2dForceFail` |
| `scripts/phase2d-seed.ts` | New – multi-org seed |
| `scripts/phase2d-test.ts` | New – isolation, analytics, worker, dead letter tests |
| `package.json` | Added `phase2d:seed`, `phase2d:test` scripts |

## RBAC Behavior

Phase 2B RBAC behavior is unchanged. Phase 2D only adds validation and test infrastructure.
