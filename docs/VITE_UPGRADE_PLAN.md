# Vite 5 → 8 upgrade plan

**Status: ✅ DONE.** Executed on `chore/vite-8-upgrade`. Landed `vite@8.1.5`,
`@vitejs/plugin-react@5`, `vitest@4.1.10`, plus two peer bumps the plan missed
(see "What the plan got wrong" below). Audit went **33 → 28**, and the lone
**critical was cleared**. Build, typecheck and all tests green.

## Outcome

| | Before | After |
|---|---|---|
| Advisories | 33 (1 critical, 4 high) | **28 (0 critical, 2 high)** |
| Client build | ~13 s | **~2.4 s** (Vite 8 uses Rolldown) |
| Tests | 182 passing | 182 passing (on Vitest 4) |

## What the plan got wrong (worth remembering)

1. **`esbuild` was NOT independent.** The plan said esbuild "is used only for
   the server bundle … leave as-is". Wrong: Vite 8 declares a peer of
   `esbuild@^0.27 || ^0.28`, so it had to go `0.25 → 0.28` too. The server
   bundle step still builds fine.
2. **`@types/node` blocked the install.** Vite 8 peers on
   `@types/node@^20.19 || >=22.12`; the repo pinned `20.16.11`. Bumped to `^22.12`
   to match the Node 22 runtime.
3. **Vitest 4 needs an explicit JSX transform.** `tsconfig` sets
   `jsx: "preserve"` (right for the Vite build). Vitest 2 transformed `.tsx`
   implicitly; Vitest 4 does not, and failed import analysis on any test that
   imports a `.tsx` module. Fixed by adding `plugins: [react()]` to
   `vitest.config.ts`.

The two de-risking facts *were* right: no DOM test env to keep in sync, and no
config rewrite was needed beyond the JSX plugin.

## Verified after the upgrade
- `npm run build` green; `dist/index.js` server bundle unchanged in shape.
- Safari chunking rule still holds — `vendor-radix` and `vendor-query` split,
  no separate React/Clerk/Recharts vendor chunks.
- Path-mounted build (`VITE_BASE_PATH=/arcarna`) emits `/arcarna/assets/…`.
- `tsc --noEmit` 0 errors; 182 tests pass.

## Remaining advisories (28) — out of scope, as planned
The Sentry/OpenTelemetry cluster (~25 moderate), `exceljs → uuid`, and
`drizzle-kit → @esbuild-kit/*`. Each is its own upgrade; none is in the
vite/vitest chain.

---

_Original plan retained below for reference._

**Status:** planned, not started. Deferred per owner; this is the execution plan for when we take the batch.
**Motivation:** clear the build-chain security advisories (1 critical + several high/moderate) that regress a plain `npm audit fix` on this lockfile, by doing the majors deliberately on one branch with build + test verification.

---

## 1. What we're on today

| Package | Current | Notes |
|---|---|---|
| `vite` | `^5.4.20` (5.4.21 installed) | HIGH advisory: path traversal in optimized-deps `.map` handling |
| `vitest` | `^2.1.9` | CRITICAL advisory via `@vitest/mocker` (UI-server arbitrary file read) |
| `@vitejs/plugin-react` | `^4.7.0` | vite 8 wants `^5` |
| `@sentry/vite-plugin` | `^5.3.0` | already compatible with vite 6/7/8 — **no change needed** |
| `esbuild` | `^0.25.0` | used **only** for the server bundle (`build` script), independent of vite — leave as-is |
| `typescript` | `5.6.3` | fine for the whole range |
| Node (build + VPS) | env has v22.22.2 | vite 8 needs Node **20.19+ / 22.12+** — verify the VPS before shipping |

### Two facts that de-risk this a lot
1. **Tests run in `environment: "node"`** (see `vitest.config.ts`) — there is **no** `jsdom` / `happy-dom` / `@testing-library` in the tree, so there is no DOM-environment package to keep version-locked with vitest.
2. **`@vitest/ui` is not installed.** The vitest *critical* is the UI server reading arbitrary files; we never run the UI, so it isn't reachable in our usage — but the advisory still flags the version, and the upgrade clears it properly.

### Config is already forward-compatible
`vite.config.ts` uses `defineConfig`, `import.meta.dirname`, `plugins`, `resolve.alias`, `build.rollupOptions.output.manualChunks`, and `server.fs` — all stable through vite 8. `vitest.config.ts` uses `vitest/config` + `defineConfig`. No deprecated options in either file. No config rewrite expected.

---

## 2. What this batch fixes (and what it does NOT)

**Cleared by the vite/vitest majors:**
- `vite` (HIGH) — optimized-deps path traversal
- `vitest` (CRITICAL) + `@vitest/mocker` (moderate) + `vite-node` (moderate)
- `postcss` (HIGH) — pulled fresh & patched transitively by vite 8
- `esbuild` dev-server request advisory (moderate) — vite 8 bundles a patched esbuild for its own dev server

**Explicitly OUT of scope (separate remediations — do NOT let them expand this branch):**
- `@sentry/node` → OpenTelemetry cluster (~20 moderate) — Sentry SDK upgrade, own branch
- `exceljs` → `uuid` (moderate) — the deferred `exceljs/uuid` item
- `drizzle-kit` → `@esbuild-kit/*` deprecated chain (moderate) — drizzle-kit upgrade
- `js-yaml`, `brace-expansion` (high), `body-parser` (low) — other tooling transitives

Set the expectation up front: after this batch `npm audit` will still show a non-zero count. Success = the vite/vitest/postcss/esbuild lines above are gone, **build passes, all 49 test files pass**. Not "audit reaches zero."

---

## 3. Recommended route: one coordinated jump, not 5→6→7→8

Because vite and vitest share the same `vite` dependency, incremental single-major hops (5→6, 6→7, 7→8) each force a matching vitest bump anyway, so you pay the coordination cost three times for no extra safety. Do it **once**, on its own branch, with a full verification gate.

**Target set (single branch `chore/vite-8-upgrade`):**
```
vite                 ^5.4.20  →  ^8
@vitejs/plugin-react ^4.7.0   →  ^5
vitest               ^2.1.9   →  ^4      (vitest 4 pairs with vite 6–8)
@sentry/vite-plugin  ^5.3.0   →  (keep; bump to latest 5.x only if needed)
```

Fallback if vite 8 surfaces a blocker (e.g. a plugin or VPS Node constraint): **stop at vite 7 + vitest 3**. That tier already clears the critical + the vite/postcss highs — vite 8 is polish, not the security payload.

---

## 4. Step-by-step

1. **Pre-flight**
   - Confirm VPS Node ≥ 20.19 / 22.12 (`ssh … node -v`). If lower, upgrade Node on the VPS **first** — this is the one true external dependency.
   - Branch from latest `main`: `git fetch origin main && git checkout -B chore/vite-8-upgrade origin/main`.
   - Snapshot for rollback: `cp package.json package.json.bak && cp package-lock.json package-lock.json.bak`.

2. **Bump + install**
   - `npm i -D vite@^8 @vitejs/plugin-react@^5 vitest@^4`
   - Do a clean resolve: `rm -rf node_modules package-lock.json && npm install` (avoids the partial-tree lockfile regression we hit with `audit fix`).

3. **Build gate** — `npm run build`
   - `vite build` must produce `dist/public`; the esbuild server bundle step is unaffected.
   - Watch for: `manualChunks` behavior (Radix/Query vendor chunks still split; React/Clerk/Recharts still in main — this split is Safari-critical, verify the chunk list), and the `base` / `VITE_BASE_PATH` path-mount build (`VITE_BASE_PATH=/arcarna npm run build`).

4. **Test gate** — `npm run test` (`vitest run`)
   - All 49 test files, `environment: "node"`. Expect near-zero churn since there's no DOM env. If anything breaks it'll be vitest 4 API (e.g. `vi.mock` factory hoisting, spy defaults) — localized, not systemic.
   - Run once **with** and once **without** `DATABASE_URL` (the config excludes two integration tests when it's unset).

5. **Runtime smoke (local `npm run start` against a prod build)**
   - App boots, Clerk auth loads, POS + products + insights render, Recharts charts draw (chunking regressions show up here), service worker registers.

6. **Audit delta** — `npm audit`
   - Confirm the vite/vitest/postcss/esbuild-devserver lines are gone. Record the new count in `docs/ARCARNA_REMEDIATION_CHECKLIST.md` (row at `vitest →4, exceljs/uuid, vite 5→8`). Remaining lines = the out-of-scope items in §2; note them, don't chase them here.

7. **PR + merge to `main`**, then deploy: `cd /root/ARCARNA && git pull origin main && npm run deploy` (build happens on the VPS — hence the Node pre-flight in step 1).

---

## 5. Rollback

Single branch, single revert. If the build/test gate fails and can't be resolved in-session:
- restore `package.json` + `package-lock.json` from the `.bak` copies, `npm install`, and drop the target to the vite 7 / vitest 3 fallback tier.
- Nothing here touches runtime app code or the DB, so revert is clean — the blast radius is dev/build tooling only.

## 6. Effort

Half a day realistically: ~30 min bumps + clean install, the rest is the build/test/smoke gate and chasing any vitest-4 test-API nits. The absence of a DOM test environment and the already-modern config files are why this is a contained batch rather than a multi-day migration.
