# Execution Briefs — Post-Stabilise

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

Every brief must:

- Keep PR small (target < 600 lines diff; exceptions noted).
- Run `npm run check` and `npm run build` before opening PR.
- Never run `npm run db:push` against production.
- Never commit `.env*` files.
- Cite the architectural principle being honoured in the PR description if it touches storage, routes, schema, or workers.

## Phase order

After S1–S8 and C1–C5 are merged, execute in this order:

1. **M1** — dead-code purge + dependency cleanup (small + unblocks F/U work in the same files).
2. **F1** — email receipts (highest-ROI user-visible win).
3. **A1** — daily KPI card (high-visibility dashboard win).
4. **F2** → **F3** — shifts/Z-report → refunds polish.
5. **F4** → **F5** → **F6** — gift cards, loyalty UX, barcode scanner.
6. **U1** → **U5** — UX polish (run in parallel with A2–A5 if capacity allows).
7. **A2** → **A5** — analytics surfaces.
8. **M2** → **M4** — structural cleanup as pressure builds.
9. **U6** → **U7** — onboarding + tablet POS layout when new-org acquisition matters.
10. **L1**–**L7** — long-horizon, brief them when prioritised.

## Index

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
