# Hygiene PR: Remove duplicate `client/client/`

## Verdict

**`client/client/` was dead** — a full duplicate of the Vite app under `client/src/`, not referenced by build, TypeScript, or imports.

## Evidence

| Check | Result |
|--------|--------|
| **Vite** (`vite.config.ts`) | `root`: `client/`; `@` alias: `client/src`; entry from `client/index.html` → `/src/main.tsx` |
| **TypeScript** (`tsconfig.json`) | `include` only `client/src/**/*` — nested tree was never compiled |
| **Grep** `client/client` in `*.{ts,tsx,js,json}` | No matches |
| **Grep** imports into nested path | None |

## Changes

- **Removed** entire directory `client/client/` (duplicate `index.html`, `manifest.json`, `sw.js`, `src/**`).

No config edits required (nothing pointed at the nested path).

## CI / gate

- `npm run check` — run after deletion  
- `npm run gate` — run after deletion (check-only without `DATABASE_URL` expected green)

## UX / backend

None. No application code or server changes.
