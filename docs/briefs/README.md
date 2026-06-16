# Execution Briefs — Post-Stabilise

**Start here:** [`MASTER_EXECUTION_PLAN.md`](./MASTER_EXECUTION_PLAN.md) · **Status:** [`BRIEF_STATUS.md`](./BRIEF_STATUS.md) · **Gaps:** [`GAPS_BACKLOG.md`](./GAPS_BACKLOG.md) · **Deploy + QA:** [`WAVE12_LAUNCH.md`](./WAVE12_LAUNCH.md) · **Next work:** [`WAVE13_NEXT.md`](./WAVE13_NEXT.md)

Waves **0–12** on `main` (`a37e9ae` — PRs #31–#39). Production on **VPS1** `/root/ARCARNA`. Wave **13** = import empty states, `lint:strict`, ops drills (O2/O3).

This directory contains full execution briefs for everything that ships **after** the Stabilise (S1–S8) and Channel Readiness (C1–C5) phases land. Each brief is self-contained so any agent (any model) can pick one up, execute it, open a PR, and stop.

Source plan: [`.cursor/plans/midnightepos_architecture_review_9a006dcf.plan.md`](../../.cursor/plans/midnightepos_architecture_review_9a006dcf.plan.md) — sections 15 and 16. These briefs expand the compact entries in section 16 into the same Goal / Touch / Steps / Out of scope / DoD / Verification / PR-title format used for S1–S8.

## Conventions

Every brief:

- **Goal:** one-sentence outcome.
- **Touch:** file deltas (`+` added, `~` modified, `-` removed).
- **Steps:** numbered, in order, low ambiguity.
- **Out of scope:** explicit anti-scope so the agent doesn't drift.
- **DoD:** acceptance criteria the PR must meet before merge.
- **Verification:** commands or manual checks proving DoD.
- **PR title:** suggested commit / PR title.

**Dependency updates:** Renovate (`renovate.json` at repo root) opens grouped patch PRs; dev-dependency patches may automerge when CI passes. Major bumps require dashboard approval.

Every brief must:

- Keep PR small (target < 600 lines diff; exceptions noted).
- Run `npm run check` and `npm run build` before opening PR.
- Never run `npm run db:push` against production.
- Never commit `.env*` files.
- Cite the architectural principle being honoured in the PR description if it touches storage, schema, or workers.
- **Logo (mandatory for any UI work):** Use only the official brand files in `client/public/brand/` (`arcarna-mark.png`, `arcarna-wordmark.png`). Do **not** redraw, approximate, or “improve” the mark in code, CSS, SVG, or AI mockups. Hull shapes (M-profile, etc.) may echo the logo’s geometry as layout inspiration; the rendered logo asset itself is fixed. See `docs/ux-concepts/_shared-context.md` § Brand.

## Stabilise + Channel Readiness status

**S1–S8 and C1–C5 are merged on `main`** (as of May 2026). Channel readiness landed in PR #14 (`feat(channels): C1–C5`). CI on `main`: TypeScript check, migration sanity, release gate.

**Phase M (M1–M4)** — **M1–M3** and **M4 scripts** on `main`. **M4 restore drill** = operator task **O2** (see [`GAPS_BACKLOG.md`](./GAPS_BACKLOG.md)).

## Phase order (historical — most items complete)

Original sequence from the architecture review. **Current truth:** [`BRIEF_STATUS.md`](./BRIEF_STATUS.md).

| Phase | On `main`? |
|-------|------------|
| M1–M3, M4 scripts | Yes |
| F1–F7, A1–A5 | Yes |
| U1–U4, U2, E1–E3, P10a–e | Yes (U5 partial; U6–U7 planned) |
| H1–H4, O4 | Yes (O1–O3 operator) |
| U6 → U7 | **Wave 9** next |
| L1–L7 | Deferred |

## Index

### Status & backlog
- [`BRIEF_STATUS.md`](./BRIEF_STATUS.md) — every brief ID: Done / Partial / Ops / Planned
- [`GAPS_BACKLOG.md`](./GAPS_BACKLOG.md) — DoD gaps and snags with checkboxes

### Phase M — Maintenance & cleanup
- [`PHASE_M_CLEANUP.md`](./PHASE_M_CLEANUP.md) — **M1** (dead code purge, partial — what's left after PR #11), **M2** (routes split), **M3** (feature flags), **M4** (backup automation).

### Phase F — Retail features
- [`PHASE_F_FEATURES.md`](./PHASE_F_FEATURES.md) — **F1** email receipts, **F2** shifts + Z-report, **F3** refunds polish, **F4** gift cards / store credit, **F5** loyalty UX, **F6** barcode scanner first-class.

### Phase U — UX polish
- [`PHASE_U_UX_POLISH.md`](./PHASE_U_UX_POLISH.md) — **U1** skeleton + empty-state pass, **U2** Cmd-K palette, **U3** saved filter views, **U4** bulk actions, **U5** accessibility audit, **U6** onboarding wizard, **U7** tablet POS layout.

### Phase A — Analytics & insights
- [`PHASE_A_ANALYTICS.md`](./PHASE_A_ANALYTICS.md) — **A1** daily KPI card, **A2** RFM segmentation, **A3** hour-of-day heatmap, **A4** stock turn ratio, **A5** promotion lift.

### Phase L — Long horizon
Not yet briefed. Surface from the plan when prioritised:
- L1 mobile manager view · L2 public storefront · L3 WhatsApp ingest · L4 multi-currency · L5 i18n + RTL · L6 Postgres RLS · L7 AI features.
