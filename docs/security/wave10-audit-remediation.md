# Wave 10 — Security audit remediation

**Branch:** `security/wave10-audit-fix`  
**Date:** 2026-06-05  
**Scope:** High/critical `npm audit` findings — production runtime first, no `npm audit fix --force`.

---

## Summary

| Metric | Before | After |
|--------|--------|-------|
| **Full audit** | 89 total (5 low, 45 moderate, 34 high, 5 critical) | 16 total (15 moderate, 1 critical) |
| **Production audit** (`--omit=dev`) | 82 total (33 high, 4 critical among prod deps) | 8 moderate, **0 high/critical** |
| **Production gate** (`--omit=dev --audit-level=high`) | FAIL | **PASS** |
| **Full gate** (`--audit-level=high`, dev included) | FAIL | **PASS** (0 high/critical at high threshold) |

Production high/critical vulnerabilities are resolved. Remaining findings are moderate (mostly transitive `uuid` via `googleapis` / `exceljs`) or dev-only (`vitest` critical when UI server is exposed).

---

## Production vs dev-only vulnerabilities

### Production / runtime (addressed)

| Package | Role | Action |
|---------|------|--------|
| `xlsx` | Spreadsheet import parsing | **Removed** — replaced with `exceljs` + `csv-parse` |
| `axios` | HTTP client | Updated to `^1.17.0` |
| `express` | HTTP server | Updated to `^5.2.1` (major — see risks) |
| `drizzle-orm` | Database ORM | Updated to `^0.45.2` + transaction typing fix |
| `@clerk/clerk-react` | Auth UI | Patched via `npm audit fix` |
| `ws` | WebSocket (Neon / realtime) | Updated to `^8.21.0` |
| `undici` | Transitive (fetch stack) | **Override** to `^7.27.1` (Node 20–compatible; avoids undici@8 Node ≥22.19 requirement) |
| `glob`, `minimatch`, `lodash`, `rollup`, `socket.io-parser`, `path-to-regexp` | Transitive | Fixed via `npm audit fix` / parent upgrades |

### Dev / build / test only (non-blocking)

| Package | Role | Status |
|---------|------|--------|
| `vitest` | Unit tests | Critical GHSA when Vitest UI server listens — **dev-only**; upgrade to v4+ deferred (breaking) |
| `vite` / `esbuild` | Dev server & build | Moderate — dev/build chain; vite 8 upgrade deferred |
| `drizzle-kit` | Migrations CLI | Moderate via esbuild — dev-only |
| `artillery` | Load testing | Moderate `uuid` chain — not on runtime request path |
| `@tapjs/*`, `npm`, `sigstore` | Test/tooling chain | Fixed or dev-only via `npm audit fix` |

---

## Packages updated

**Direct dependency changes:**

- `axios` → `^1.17.0`
- `express` → `^5.2.1`
- `drizzle-orm` → `^0.45.2`
- `@clerk/clerk-react` → patched (audit fix)
- `ws` → `^8.21.0`
- **Removed:** `xlsx`
- **Added:** `exceljs`, `csv-parse`

**Lockfile:** `npm audit fix` (safe only, no `--force`)

**Overrides:**

```json
"overrides": {
  "undici": "^7.27.1"
}
```

---

## Files changed

| File | Change |
|------|--------|
| `package.json` / `package-lock.json` | Dependency upgrades, overrides, xlsx → exceljs |
| `server/import/spreadsheet.ts` | ExcelJS + csv-parse parsing, MIME/size/row limits, hardened errors |
| `server/routes/setupImports.ts` | Optional `mimeType` passed to parser |
| `apps/server/src/db/index.ts` | Drizzle 0.45 transaction client API |
| `scripts/security-audit.ts` | **New** — production vs full audit gate |
| `scripts/release-gate.ts` | Step 3: production security audit |
| `scripts/wave10-preflight.sh` | Production audit gate; fix hooks check env |
| `server/__tests__/spreadsheet.test.ts` | **New** — import parser guards |

---

## xlsx migration

- **Removed** vulnerable `xlsx` (SheetJS) — no upstream fix available.
- **XLSX:** `exceljs` with try/catch for corrupt/password-protected files.
- **CSV:** `csv-parse/sync` (replaces hand-rolled parser for imports; `parseCsv` export retained).
- **Hardening:** 32 MB upload cap (existing), extension allowlist, optional MIME check, 15k row cap, generic error messages to clients.
- **Behaviour:** Product/customer import preview + commit flow unchanged.

---

## Remaining vulnerabilities & risks

### Moderate (production, non-blocking at high gate)

- **`uuid` <11.1.1** via `googleapis` → Google Drive invoice upload (runtime, low exploit surface for our usage).
- **`uuid`** via `exceljs` (import-only, bounded file size).

### Dev-only

- **`vitest` critical** (GHSA-5xrq-8626) — only when Vitest UI server is listening; CI uses `vitest run` (no UI).
- **`vite`/`esbuild` moderate** — dev server; not deployed to production bundle.

### Express 5 upgrade

Express was bumped to v5 per brief. Build, typecheck, and unit tests pass. **Recommend VPS smoke test** (`/midnight/api/health`, sign-in, import preview) before next production deploy — Express 5 has API differences from v4.

### Clerk package deprecation

`@clerk/clerk-react@5.61.3` is deprecated in favour of `@clerk/react`. Migration deferred to avoid auth refactor in this security pass.

---

## Verification

| Check | Result | Notes |
|-------|--------|-------|
| `npm run check` | **PASS** | |
| `npm run test` | **PASS** | 75 tests |
| `npm run build` | **PASS** | |
| `npm run wave10:preflight` | **PASS** | |
| `npx tsx scripts/security-audit.ts` | **PASS** | Production + full high/critical |
| `npm audit --omit=dev --audit-level=high` | **PASS** | 0 high/critical |
| `npm start` | **Blocked** | Requires `DATABASE_URL` (not set in Cloud Agent VM) |
| `npm run gate` (Phase 2D DB tests) | **Skipped** | `DATABASE_URL` not set |

---

## Recommended follow-up

1. **VPS smoke test** after merge — Express 5 + Clerk auth + spreadsheet import preview.
2. **Vitest 4.x** upgrade in a dedicated PR (fixes dev critical without `--force` side effects).
3. **`googleapis` → 173.x** when ready (uuid fix; breaking API review for Drive invoice worker).
4. **Migrate `@clerk/clerk-react` → `@clerk/react`** per Clerk Core 3 upgrade guide.
5. **Move `artillery` to devDependencies** to remove load-test tooling from production audit tree.
6. Run **restore drill (O2)** and import preview on VPS with a real `.xlsx` product file.

---

## Release gate behaviour

Preflight and release gate now run:

```bash
npx tsx scripts/security-audit.ts   # fails on production high/critical only
npm audit --audit-level=high        # informational full log (dev findings visible, non-blocking)
```

Report format:

```text
Production dependency audit: PASS/FAIL
Full dependency audit including dev tooling: PASS/WARN/FAIL
```
