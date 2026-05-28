# Phase M — Maintenance & cleanup

**Prerequisite:** S1–S8 and **C1–C5 merged on `main`** (done). This phase is ready to start.

Four briefs: **M1** dead-code purge (partial — accounts for #11 already retiring `webpack.yml`), **M2** routes split, **M3** feature flags, **M4** backup automation. Execute M1 first; the others can interleave with Phase F.

> UI-facing work in later phases must use official logo assets only (`client/public/brand/*.png`) — see `docs/briefs/README.md` and `docs/ux-concepts/_shared-context.md`.

---

## Brief M1 — Dead-code purge + dependency cleanup

**Goal:** Remove confirmed-unused code and dependencies. Eliminate the "sediment layers" called out in §6 of the architecture review. Adds `npm test` to CI.

**Pre-existing context:** PR #11 already deleted `.github/workflows/webpack.yml`. This brief picks up the remaining items.

**Touch:**

- `- apps/web/` (entire directory) — abandoned web app, confirmed no imports from the deployed app
- `- generateInvoice.ts` (repo root, if present)
- `- server/replitAuth.ts` — **only** if `process.env.AUTH_PROVIDER === "clerk"` is the only supported value going forward; verify with `git grep AUTH_PROVIDER` and confirm with operator before deleting
- `~ package.json` — remove unused dependencies (verify each via `git grep` first):
  - `react-router-dom` (we use `wouter`)
  - `vite-plugin-pwa`, `workbox-window` (we hand-roll the service worker)
  - `@replit/vite-plugin-*` (Replit-only dev tooling)
- `~ .github/workflows/ci.yml` — add `npm test` step (runs Vitest)
- `+ renovate.json` (optional) — monthly dep-update PRs

**Steps:**

1. For each candidate path, run `git grep "<path-or-import>"`. If zero hits in `client/`, `server/`, or `shared/`, mark for deletion.
2. For each candidate dep, run `git grep "from ['\"]<dep>['\"]"` and `git grep "require(['\"]<dep>['\"])"`. If zero hits, remove from `package.json`.
3. After each removal batch run `npm run check && npm run build && npm test`. If anything breaks, revert the batch.
4. Add `npm test` step in `ci.yml` under the TypeScript-check job (or as its own job that needs `check`).
5. (Optional) Drop a minimal `renovate.json` enabling automerge of patch-level dev-deps; major bumps stay manual.
6. Record bundle-size delta in the PR description (`du -sh dist/public dist/portal` before vs after).

**Out of scope:**

- Replacing `apps/server/` library code — it's still consumed by `server/engine.wiring.ts` (only the standalone `index.ts` was retired in S2).
- Removing `server/legacyRedirects.ts` — keep until analytics show zero traffic on old URLs.
- Touching active deps even if "feels old".

**DoD:**

- `npm run check`, `npm run build`, `npm test` all green.
- `git grep "apps/web"` and `git grep "generateInvoice"` return only doc / comment hits (no code).
- Bundle size or `node_modules` size drops measurably; numbers in PR.
- CI runs `npm test` and fails the build if any test fails.

**Verification:**

- Diff PR shows only deletions, `package.json` / `package-lock.json` updates, and the CI step.
- `pm2 logs` after deploy: no errors referencing removed modules.

**PR title:** `chore: purge apps/web + unused deps; run npm test in CI`

---

## Brief M2 — Split `server/routes.ts` into per-domain files

**Goal:** Reduce `server/routes.ts` to a thin composition root (< 200 lines) by moving each domain's routes into `server/routes/<domain>.ts`. Pure refactor; zero behaviour change.

**Touch:**

- `~ server/routes.ts` — becomes a router-of-routers that imports and mounts each domain file
- `+ server/routes/orders.ts`
- `+ server/routes/products.ts`
- `+ server/routes/customers.ts`
- `+ server/routes/inventory.ts`
- `+ server/routes/reports.ts`
- `+ server/routes/analytics.ts`
- `+ server/routes/loyalty.ts`
- `+ server/routes/promotions.ts`
- `+ server/routes/admin.ts`
- `+ server/routes/auth.ts` (already exists in legacy form — refactor)
- `+ server/routes/health.ts` (split out `/api/health*`)
- Existing `server/routes/channels.ts` stays (added in C1–C5)
- `~ docs/ROUTE_TEMPLATE.md` — update with the per-domain pattern

**Steps:**

1. For each domain identify its routes by `git grep "app\.(get|post|put|patch|delete)\(['\"]/api/<domain>"` in `server/routes.ts`.
2. Move the routes into `server/routes/<domain>.ts` exporting `register<Domain>Routes(app, scopedMw)`. Preserve order, middleware, and types exactly.
3. In the new `server/routes.ts`, the body becomes:
   ```ts
   import { registerOrdersRoutes } from "./routes/orders";
   // ...one import per domain...
   export async function registerRoutes(app: Express) {
     await setupAuth(app);
     const scoped = [isAuthenticated, requireOrgContext, requireOrgScope];
     registerHealthRoutes(app);
     registerAuthRoutes(app, scoped);
     registerOrdersRoutes(app, scoped);
     // ...
     return createServer(app);
   }
   ```
4. Run `npm run check` after each domain move; commit per domain so reverts are trivial.
5. Update `docs/ROUTE_TEMPLATE.md` with the canonical per-domain shape and the rule "routes do auth + validation + delegation only; business logic lives in `server/services/<domain>/`".

**Out of scope:**

- Introducing a service layer (`server/services/`). Document it as the next step but don't build it here.
- Behaviour changes — purely mechanical move.
- Touching `server/storage.ts` shape.

**DoD:**

- `server/routes.ts` < 200 lines.
- Each per-domain file < 600 lines.
- `npm run check`, `npm run build`, `npm test` green.
- All existing routes return identical responses (manually probe one route per domain).

**Verification:**

- `wc -l server/routes.ts server/routes/*.ts` — every file under threshold.
- Smoke test: hit `/api/health`, `/api/orders`, `/api/products`, `/api/customers`, `/api/admin/audit-logs` against a dev server; identical responses to a pre-merge run.

**PR title:** `refactor(server): split routes.ts into per-domain modules`

---

## Brief M3 — Feature flags table + `useFlag` hook

**Goal:** Per-org feature toggles backed by a database table so we can roll new features incrementally (org-by-org) with a kill-switch on each.

**Touch:**

- `+ migrations/021_feature_flags.sql` — `feature_flags (org_id uuid not null, flag varchar(64) not null, enabled boolean not null default false, updated_at timestamptz default now(), primary key (org_id, flag))`
- `~ shared/schema.ts` — Drizzle model for the table
- `+ server/routes/featureFlags.ts` — `GET /api/feature-flags` (current org), `PUT /api/feature-flags/:flag` (ADMIN+)
- `+ server/featureFlags.ts` — `isFlagEnabled(orgId, flag)`; in-memory 60s LRU cache; invalidate on PUT
- `+ client/src/hooks/useFlag.ts` — `useFlag('newCheckout')` returns `{ enabled, isLoading }`; backed by TanStack Query, cached 60s
- `+ client/src/pages/settings/feature-flags.tsx` — ADMIN+ page listing known flags; toggle + audit trail
- `~ docs/ARCHITECTURAL_PRINCIPLES.md` — add principle "all in-progress features ship behind a flag"

**Steps:**

1. Migration is idempotent (`CREATE TABLE IF NOT EXISTS`).
2. Server `isFlagEnabled` caches per `(orgId, flag)` for 60s; invalidates on the PUT route.
3. Routes follow `scoped` middleware and `requireRole('ADMIN', 'SUPER_ADMIN')` for writes.
4. Hook: `useFlag(name)` queries `/api/feature-flags`, picks the flag, refetches on focus.
5. Settings page shows an explicit allow-list of "known" flags (declared in `shared/featureFlags.ts`) with description + default; unknown flags are read-only debug rows.
6. Audit log entry on every toggle (via `recordAdminAudit` from S7).

**Out of scope:**

- Percentage rollouts / A/B framework. Org-level boolean only.
- Per-user flags.
- Remote config service.

**DoD:**

- Toggling a flag in the UI takes effect within 60s on every connected client.
- Migration idempotent on re-run.
- `useFlag('nonExistent')` returns `enabled: false` (no error).
- Audit log shows toggles.

**Verification:**

- Set `enabled = true` via UI → page using `useFlag` re-renders within 60s.
- `npm run check`, `npm run build`, `npm test` green.

**PR title:** `feat(platform): per-org feature flags + useFlag hook`

---

## Brief M4 — Backup automation: nightly Neon dump → R2

**Goal:** Nightly `pg_dump` of Neon → Cloudflare R2 (or S3-compatible) with 30-day rotation, plus a documented restore drill executed once.

**Touch:**

- `+ scripts/backup-neon-to-r2.sh` — pulls `DATABASE_URL`, runs `pg_dump --no-owner --no-privileges --format=custom` into `/tmp`, uploads to R2 via `aws s3 cp` (using R2's S3-compatible API)
- `+ scripts/restore-from-r2.sh` — companion: list / download / `pg_restore`
- `~ docs/DISASTER_RECOVERY.md` — created if absent: backup strategy, retention, runbook for restore drill
- `~ .env.production.example` — add `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT`
- `~ docs/DEPLOY_HOSTINGER_VPS.md` — add a section "Backup cron" referencing the script

**Steps:**

1. Script uses `pg_dump` v16 (matches Neon); produces `midnight-YYYY-MM-DD-HHMMSS.dump`.
2. Upload via `aws --endpoint-url $R2_ENDPOINT s3 cp` (R2 supports S3 v4).
3. Rotation: after upload, list bucket and delete objects older than 30 days (also via `aws s3 ls / rm`).
4. Cron entry in `scripts/cron.example`: `15 2 * * * /opt/midnight/scripts/backup-neon-to-r2.sh >> /var/log/midnight-backup.log 2>&1`.
5. `restore-from-r2.sh` accepts a date or "latest"; pipes through `pg_restore --clean --if-exists` into a target URL.
6. **Restore drill**: spin up a fresh Neon branch, run the script, confirm row counts match within 1% of source; document timing and any glitches in `DISASTER_RECOVERY.md`.
7. (Optional) post a Slack / email summary on script success/failure if `BACKUP_NOTIFY_WEBHOOK` is set.

**Out of scope:**

- Continuous WAL archiving (Neon already provides PITR).
- Application-level backups (uploaded files) — separate brief when Files portal is live.
- Encrypting dumps client-side beyond R2's at-rest encryption.

**DoD:**

- Script runs end-to-end on the production VPS without prompts; dump appears in R2.
- Rotation works (manually create a 31-day-old object then run script; it's deleted).
- Restore drill documented in `DISASTER_RECOVERY.md` with date, dump used, time-to-restore, row-count verification.
- Cron line added to `cron.example` with timezone note.

**Verification:**

- `bash scripts/backup-neon-to-r2.sh` on the VPS exits 0 and a new dump exists in R2.
- `aws --endpoint-url $R2_ENDPOINT s3 ls $R2_BUCKET/` shows dumps within the 30-day window only.
- `bash scripts/restore-from-r2.sh latest <target-db-url>` restores into a scratch DB; sanity-check tables.

**PR title:** `feat(ops): nightly Neon → R2 backups with restore drill`
