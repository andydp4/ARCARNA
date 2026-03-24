# Phase 2B Final Report

## 1. Repo Enforcement Behavior

**ProductsRepoDrizzle.update/delete** (apps/server/src/db/repos.ts):
- `update(id, updates, orgId?)`: When `orgId` provided, `whereCond = and(eq(id), eq(org_id, orgId))`. Throws `'Product not found'` if `!updated` (0 rows affected).
- `delete(id, orgId?)`: When `orgId` provided, same `whereCond`. Uses `.returning({ id })` and throws `'Product not found'` if `orgId && !deleted` (0 rows affected).

**CustomersRepoDrizzle.update/delete**:
- Same pattern: filter by `(id AND org_id)` when `orgId` provided; throw on 0 rows.

## 2. Route Behavior

**Update/delete product/customer routes** (server/routes.ts):
- Pass `ctx?.orgId ?? undefined` into `engine.updateProduct`, `engine.updateCustomer`, `engine.deleteProduct`, `engine.deleteCustomer` (lines 174, 266, 200, 281).
- Keep scoped pre-check: `storage.getProduct(id, ctx?.orgId)` / `storage.getCustomer(id, ctx?.orgId)` → 404 if null, before engine call.
- Pre-check prevents leaking existence across orgs.

## 3. Type Safety / @midnight/domain

**Resolution fix:** Added to root `tsconfig.json`:
```json
"@midnight/domain": ["./packages/domain/src/index.ts"],
"@midnight/domain/*": ["./packages/domain/src/*"]
```
- `npm run check` no longer reports "Cannot find module @midnight/domain".
- Remaining TS errors: apps/server schema vs shared schema drift (order_items/orders/customer_metrics column types), client promotions/locations/orders typing, domain events/status unions, engine.wiring top-level await, pdf Uint8Array, etc. These are pre-existing or schema-consistency issues, not introduced by Phase 2B RBAC changes.

## 4. Migration Safety

**001_analytics_org_pk.sql:**
- Pre-check: `SELECT COUNT(*) FROM organizations`; if `> 1`, `RAISE EXCEPTION` with message to use multi-org script.
- Multi-org script: `001_analytics_org_pk_with_org.sql` requires `-v org_id=UUID`.

**Docs** (docs/PHASE2B_MIGRATION_PLAN.md):
- Mandatory pre-check step before running 001.
- Two paths documented: single-org (0 or 1 org) vs multi-org (explicit org_id).

---

## Files Changed (Phase 2B)

| File | Change |
|------|--------|
| packages/domain/src/ports.ts | `update`/`delete` optional `orgId` param |
| packages/domain/src/engine.ts | `updateProduct`/`updateCustomer`/`deleteProduct`/`deleteCustomer` accept and pass `orgId` |
| apps/server/src/db/repos.ts | `ProductsRepoDrizzle`/`CustomersRepoDrizzle`: org filter + NotFound on 0 rows for update/delete |
| apps/server/src/db/memory.repos.ts | Interface compliance (optional orgId params) |
| server/routes.ts | Pass `ctx.orgId` to engine; use engine for delete (with pre-check); tick-customers explicit org guard |
| tsconfig.json | Paths for `@midnight/domain` |
| migrations/001_analytics_org_pk.sql | Pre-check for multi-org |
| migrations/001_analytics_org_pk_with_org.sql | New multi-org script |
| migrations/002_org_not_null.sql | Explicit NULL pre-check before ALTER |
| docs/PHASE2B_MIGRATION_PLAN.md | Pre-check + two-path docs |

## Breaking Changes

- **Engine/repos API:** `ProductsRepo.update(id, updates, orgId?)`, `delete(id, orgId?)`; `CustomersRepo` same. Optional params—backward compatible.
- **Routes:** Product/customer delete now go through engine (with orgId) instead of storage. Behavior equivalent for scoped requests.

## TS Errors: Pre-existing vs New

| Category | Status |
|----------|--------|
| @midnight/domain resolution | **Fixed** (path mapping) |
| Phase 2B–introduced (ports, engine, repos, routes) | None |
| apps/server schema (order_items org_id, orders, customer_metrics) | Pre-existing schema/sync drift |
| apps/server engine.wiring top-level await | Pre-existing |
| client promotions/locations/orders | Pre-existing |
| packages/domain events/status unions | Pre-existing |
| server/storage, server/ports | Pre-existing |
