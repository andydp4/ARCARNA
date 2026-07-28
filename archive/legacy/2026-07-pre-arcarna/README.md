# Archive — pre-Arcarna leftovers (July 2026)

Nothing in here is used by the running application. It is kept only so the
history and source material stay recoverable. **Do not import from this
directory** — anything genuinely needed should be promoted back out.

Verified unreferenced at time of archiving (`npm run build`, `tsc --noEmit`
and the test suite all pass without it).

## `attached_assets/`
Scratch working material from the Midnight-era build: pasted spec/prompt text
files, superseded Midnight logos, Orbitron font zips, and a flattened
`midnight-epos-*` source bundle. Nothing imported it — the `@assets` Vite alias
that pointed here had zero importers and was removed alongside this move.

## `handoff/`
`arcarna-style-guide.html` — a static style-guide page from the rebrand
handoff. Superseded by the live design tokens in
`client/src/styles/tokens/` (`arcarna.css`, `liquid-metal.css`) and by
`client/src/lib/reportBrand.ts` for report/export colour.

## `scripts/`
Six scripts with no references anywhere in the repo. Their only mentions were
inside the archived Midnight bundle above:

| Script | What it was |
|---|---|
| `agent-start.sh`, `agent-test.sh` | Midnight-era agent bootstrap helpers |
| `dataPurge.js` | ad-hoc data wipe |
| `generateMockTransactions.js` | mock transaction seeding (superseded by `scripts/seed.ts`) |
| `loadTest.js`, `securityTest.js` | one-off load/security probes (superseded by `scripts/security-audit.ts` and `tests/`) |

## Deliberately NOT archived
Checked and found still live, despite looking stale:

- **`scripts/phase2d-*.ts`** — still referenced by `package.json` and
  `server/workers/phase2dForceFailGuard.ts`.
- **`client/public/brand/arcarna-mark.png` / `arcarna-wordmark.png`** — served
  via `shared/brand.ts` → `BrandLogo`.
- **`client/src/styles/tokens/liquid-metal.css`** — this is the *active* design
  system (defines the `:root` tokens the whole UI reads), not legacy branding.
- **`.replit`** — Replit auth paths are still referenced from `server/auth/`.
