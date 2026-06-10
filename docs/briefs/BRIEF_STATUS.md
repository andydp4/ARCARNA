# Brief status tracker

**Last updated:** 2026-06-10 · **`main` ref:** Wave 10 on `main` (through PR #31); Wave 11 queued — [`WAVE11_NEXT.md`](./WAVE11_NEXT.md)

**Sources of truth:** git `main`, wave merge docs (`WAVE3_NEXT` … `WAVE8_NEXT`), codebase grep.  
**Gaps & snags:** [`GAPS_BACKLOG.md`](./GAPS_BACKLOG.md) (actionable checklist).

---

## Legend

| Status | Meaning |
|--------|---------|
| **Done** | Merged on `main`; meets brief DoD |
| **Done†** | Shipped on `main`; minor deviations — see gaps backlog |
| **Partial** | Meaningful slice on `main`; remainder queued |
| **Ops** | Operator / VPS task (no PR) |
| **Planned** | Brief written; not on `main` |
| **Deferred** | Not briefed or Wave 10+ |

---

## Stabilise & channel (pre-waves)

| ID | Status | Wave / notes |
|----|--------|----------------|
| S1–S8 core | **Done** | Stabilise PRs |
| C1–C5 | **Done** | PR #14 |
| M1 | **Done** | Dead code purge, CI tests |
| M2 | **Done** | Routes split |
| M3 | **Done** | Feature flags |
| M4 scripts | **Done** | Backup scripts + DR doc |
| M4 drill | **Ops** | **O2** — restore drill not signed off |

---

## Phase H — Hardening

| ID | Status | Wave / notes |
|----|--------|----------------|
| H1 | **Done†** | Tiered limiters in `server/security.ts`; HSTS/CSP **documented**; CSP off in Node (Clerk-safe) — [GAP-H1-01](./GAPS_BACKLOG.md#gap-h1-01) |
| H2 | **Done** | `SECRET_ROTATION_RUNBOOK.md`, retention in 014 |
| H3 | **Done** | Extended `/api/health/metrics` |
| H4 | **Done** | `STORAGE_STRATEGY.md` |

---

## Phase O — Ops

| ID | Status | Wave / notes |
|----|--------|----------------|
| O1 | **Ops** | External uptime monitor |
| O2 | **Ops** | M4 restore drill on VPS/R2 |
| O3 | **Ops** | `pm2 startup` + `pm2 save` |
| O4 | **Done** | `docs/ops/INCIDENT_CHECKLIST.md` |

---

## Phase P10 — Platform

| ID | Status | Wave / notes |
|----|--------|----------------|
| P10a | **Done** | `client/src/instrument.ts`, Sentry FE + BE DSN docs |
| P10b | **Done†** | Plausible init + `docs/ANALYTICS.md`; operator dashboards optional — [GAP-P10B-01](./GAPS_BACKLOG.md#gap-p10b-01) |
| P10c | **Done** | `renovate.json` (Wave 7) |
| P10d | **Done** | Playwright smoke + CI `e2e` (Wave 8) |
| P10e | **Done** | `docs/ops/CLOUDFLARE.md` (Wave 7) |

---

## Phase E — Liquid Metal

| ID | Status | Wave / notes |
|----|--------|----------------|
| E1 | **Done** | Tokens + spatial Insights flag (Wave 0 / early) |
| E2 | **Done†** | Layout + POS shell (Wave 3); not every page reskinned — [GAP-E2-01](./GAPS_BACKLOG.md#gap-e2-01) |
| E3 | **Done** | PWA install banner (Wave 6) |

---

## Phase F — Retail

| ID | Status | Wave / notes |
|----|--------|----------------|
| F1 | **Done** | Email receipts, 022 (Wave 1) |
| F2 | **Done** | Shifts + Z-report, 023–024 (Wave 2) |
| F3 | **Done** | Refunds, 025 (Wave 2) |
| F4 | **Done** | Gift cards, 026–027 (Wave 3) |
| F5 | **Done** | Loyalty POS, 028 (Wave 4) |
| F6 | **Done** | Barcode scanner; `products.barcode` in schema — no 029 file (Wave 5) |
| F7 | **Done** | Channel attribution (Wave 6) |
| F8+ | **Deferred** | Label printing, webcam scan, etc. — see F doc + backlog |

---

## Phase U — UX polish

| ID | Status | Wave / notes |
|----|--------|----------------|
| U1 | **Done†** | Skeleton + empty states (Wave 2) — [GAP-U1-01](./GAPS_BACKLOG.md#gap-u1-01) |
| U2 | **Done†** | Cmd-K palette (Wave 3); mounted in `App.tsx` not `Layout.tsx` |
| U3 | **Done** | Saved views, 030 (Wave 4) |
| U4 | **Done†** | Bulk actions (Wave 5) — [GAP-U4-01](./GAPS_BACKLOG.md#gap-u4-01) |
| U5 | **Partial** | Axe + CI; **8b** eslint plugin on `main` — [GAP-U5-01](./GAPS_BACKLOG.md#gap-u5-01) (full `lint:strict` pending) |
| U6 | **Done** | Wizard + `031` + home banner |
| U7 | **Done†** | Tablet grid/cart split + visual spec — [GAP-E2-01](./GAPS_BACKLOG.md#gap-e2-01) POS extract optional |

---

## Phase A — Analytics

| ID | Status | Wave / notes |
|----|--------|----------------|
| A1 | **Done** | Daily KPI card (Wave 1) |
| A2 | **Done** | RFM, 032 (Wave 4) |
| A3 | **Done** | Hour-of-day heatmap (Wave 5) |
| A4 | **Done** | Stock turn (Wave 6) |
| A5 | **Done** | Promotion lift (Wave 7) |

---

## Phase L — Long horizon

| ID | Status |
|----|--------|
| L1–L7 | **Deferred** | Brief when prioritised |

---

## Wave merge history (agent waves)

| Wave | Merged to `main` | Briefs |
|------|------------------|--------|
| 0 | Yes | H2, H4, O4, E1, 014 fix |
| 1 | Yes | P10a, A1, F1 |
| 2 | Yes | U1, F2, F3 |
| 3 | Yes | U2, E2, F4 |
| 4 | Yes | U3, A2, F5 |
| 5 | Yes | A3, U4, F6 |
| 6 | Yes | E3, F7, A4 |
| 7 | Yes | P10c, P10e, A5 |
| 8 | Yes | P10d, P10b, U5 (axe) |
| 9 | Yes | U6, 8b infra, U7 layout — [`WAVE9_NEXT.md`](./WAVE9_NEXT.md) |
| 10 | Yes | PWA SW, WhatsApp, logo, Clerk auth (#30–#31), ops docs — [`WAVE10_LAUNCH.md`](./WAVE10_LAUNCH.md) |
| 11 | **Queued** | Setup wizard Liquid Metal — [`WAVE11_NEXT.md`](./WAVE11_NEXT.md) |

---

## Migrations on `main`

Applied via `scripts/apply-migrations-pm2.sh`: **001–014, 022–028, 030, 032** (gaps 015–021 intentional).

| File | Brief |
|------|-------|
| 029 | **Not in repo** — F6 uses existing `products.barcode` column |
| 031 | **Planned** — U6 onboarding |

---

## Quick counts

| | Count |
|---|------|
| **Done** on `main` | 40+ brief IDs |
| **Done† / Partial** | 6 (H1, E2, U1, U4, U5, P10b) |
| **Ops** (you) | 3 (O1–O3) + M4 drill |
| **Planned** | U6, U7, U5-8b |
| **Deferred** | L1–L7, F long-tail |
