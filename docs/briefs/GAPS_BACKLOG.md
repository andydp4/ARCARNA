# Gaps & snags backlog

**Purpose:** Close the delta between brief **Definition of Done** and what is on `main`. Check items off in PRs or ops runbooks.

**Status tracker:** [`BRIEF_STATUS.md`](./BRIEF_STATUS.md) · **Next wave:** [`WAVE11_LAUNCH.md`](./WAVE11_LAUNCH.md) (deploy + QA) · [`WAVE12_NEXT.md`](./WAVE12_NEXT.md)

---

## How to use

1. Pick an unchecked item.
2. Open the linked brief section for full DoD.
3. PR title: `fix(<area>): <gap-id> <short description>`
4. When merged, check the box here and note PR in the **Closed** column.

---

## H1 — Security hardening

<a id="gap-h1-01"></a>

### GAP-H1-01 — Production HSTS header verified

| | |
|---|---|
| **Brief** | H1 |
| **Snag** | HSTS documented in nginx example + deploy doc; **not verified** on live `viger.cloud` |
| **Fix** | On VPS: ensure Certbot HTTPS block includes `Strict-Transport-Security`; run `bash scripts/verify-production-headers.sh` or `curl -sI https://viger.cloud/midnight/api/health` |
| **Closed** | [x] 2026-06-06 — verified via `scripts/verify-production-headers.sh` (HSTS present on live) |

<a id="gap-h1-02"></a>

### GAP-H1-02 — Clerk-safe CSP strategy (optional tighten)

| | |
|---|---|
| **Brief** | H1 |
| **Snag** | `contentSecurityPolicy: false` in `server/security.ts` (intentional for Clerk+Vite) |
| **Fix** | Either document as accepted risk in `SECURITY_REVIEW.md` sign-off, or implement nginx-only CSP per H1 steps and re-test sign-in |
| **Closed** | [x] 2026-06-05 — accepted risk in `SECURITY_REVIEW.md` § CSP sign-off |

---

## E2 — Liquid Metal shell

<a id="gap-e2-01"></a>

### GAP-E2-01 — Non-POS pages Liquid Metal pass

| | |
|---|---|
| **Brief** | E2 |
| **Snag** | Wave 3 E2 scoped Layout + POS; Settings, reports, some list chrome may still use default shadcn only |
| **Fix** | Wave 10 or dedicated `feat/e2-shell-remainder` — apply `liquid-metal` / card variants per `PHASE_E_LIQUID_METAL.md` |
| **Closed** | [x] Wave 10b — settings + reports (`PageHeader`, `LM_CARD`) |

<a id="gap-e2-02"></a>

### GAP-E2-02 — Setup wizard Liquid Metal shell

| | |
|---|---|
| **Brief** | E2 |
| **Snag** | `setup-wizard.tsx` used default `bg-background` while `onboarding.tsx` / `onboarding-wizard.tsx` use `lm-auth-shell` |
| **Fix** | Wave 11 Agent 1 — [`WAVE11_NEXT.md`](./WAVE11_NEXT.md) §2 |
| **Closed** | [x] PR #32 — 2026-06-10 |

---

## U1 — Skeletons & empty states

<a id="gap-u1-01"></a>

### GAP-U1-01 — Orders / invoices empty states

| | |
|---|---|
| **Brief** | U1 |
| **Snag** | `orders.tsx`, `invoices.tsx` use `EmptyStatePanel` without primary CTA from shared `<EmptyState>` |
| **Fix** | Align with `UI_PATTERNS.md` or document exception in `UI_PATTERNS.md` |
| **Closed** | [x] Wave 10b — `EmptyState` + Open POS / View orders CTAs |

### GAP-U1-02 — Reports loading / empty

| | |
|---|---|
| **Brief** | U1 |
| **Snag** | `reports.tsx` has skeleton; no list-style empty state for zero-data dashboards |
| **Fix** | Add `EmptyState` or dashboard-specific empty panel |
| **Closed** | [x] Wave 10b — `insights.tsx` zero-data empty + Last 30 days preset |

### GAP-U1-03 — Import flows

| | |
|---|---|
| **Brief** | U1 touch list |
| **Snag** | `client/src/components/import/*` may still use legacy spinners |
| **Fix** | Pass import modals with `Skeleton` / `EmptyState` |
| **Closed** | [ ] |

---

### GAP-TEST-01 — E2E/a11y tenant context (fixed 2026-06-06)

| | |
|---|---|
| **Snag** | Playwright POS/a11y tests ran axe on onboarding wizard redirect, not tenant pages (missing org + onboarding completion) |
| **Fix** | `tests/helpers/e2eTenant.ts` — complete onboarding + set org before navigation |
| **Closed** | [x] 2026-06-06 — visual + a11y critical paths |

---

## U2 — Command palette

<a id="gap-u2-01"></a>

### GAP-U2-01 — Brief mount location

| | |
|---|---|
| **Brief** | U2 |
| **Snag** | Brief says `Layout.tsx`; implementation uses `App.tsx` (works globally) |
| **Fix** | Update `PHASE_U_UX_POLISH.md` U2 touch to `App.tsx` **or** move mount (low priority) |
| **Closed** | [x] 2026-06-06 — brief touch updated to `App.tsx` |

---

## U4 — Bulk actions

<a id="gap-u4-01"></a>

### GAP-U4-01 — Select all matching filter

| | |
|---|---|
| **Brief** | U4 |
| **Snag** | `useBulkSelection` only selects visible rows |
| **Fix** | Server-side count + “Select all N matching” with confirm |
| **Closed** | [ ] |

<a id="gap-u4-02"></a>

### GAP-U4-02 — Bulk change category (products)

| | |
|---|---|
| **Brief** | U4 |
| **Snag** | `changeCategory` in types; not in `PRODUCT_ACTIONS` or handler |
| **Fix** | Wire action + API + confirm |
| **Closed** | [ ] |

<a id="gap-u4-03"></a>

### GAP-U4-03 — Bulk export streaming

| | |
|---|---|
| **Brief** | U4 |
| **Snag** | Large CSV via `res.send` not stream |
| **Fix** | `res.write` / stream for 10k+ rows (optional until needed) |
| **Closed** | [ ] |

<a id="gap-u4-04"></a>

### GAP-U4-04 — Server Vitest for bulk routes

| | |
|---|---|
| **Brief** | U4 verification |
| **Snag** | Only `shared/bulkActions.spec.ts` |
| **Fix** | Route integration tests for `POST /api/*/bulk` |
| **Closed** | [ ] |

---

## U5 — Accessibility

<a id="gap-u5-01"></a>

### GAP-U5-01 — eslint-plugin-jsx-a11y (Wave 8b)

| | |
|---|---|
| **Brief** | U5 |
| **Snag** | Plugin + config on `main`; `npm run lint:strict` not green repo-wide |
| **Fix** | Incremental PRs to clear `npm run lint:strict`; then remove POS from `ignorePatterns` |
| **Closed** | [x] 2026-06-04 (infra) — [ ] full strict pass |

<a id="gap-u5-02"></a>

### GAP-U5-02 — Manual keyboard-only POS walkthrough

| | |
|---|---|
| **Brief** | U5 DoD |
| **Snag** | Not recorded in repo |
| **Fix** | Run once; add sign-off line to `docs/ACCESSIBILITY.md` with date |
| **Closed** | [ ] |

<a id="gap-u5-03"></a>

### GAP-U5-03 — Reduced motion on palette / dialogs

| | |
|---|---|
| **Brief** | U5 |
| **Snag** | Command palette / some modals may not honor `prefers-reduced-motion` everywhere |
| **Fix** | Audit motion classes; align with U1 `motion-reduce` pattern |
| **Closed** | [ ] |

---

## P10b — Product analytics

<a id="gap-p10b-01"></a>

### GAP-P10B-01 — Plausible dashboards (operator)

| | |
|---|---|
| **Brief** | P10b |
| **Snag** | Code env-gated; no dashboards/goals in Plausible UI |
| **Fix** | Set `VITE_PLAUSIBLE_DOMAIN` on VPS, rebuild; configure goals in Plausible |
| **Closed** | [ ] |

---

## F6 — Barcode (follow-ups)

<a id="gap-f6-01"></a>

### GAP-F6-01 — Bulk barcode print on products page

| | |
|---|---|
| **Brief** | F6 |
| **Snag** | Deferred in F6 PR |
| **Fix** | New brief **F8** or small PR: print labels from product list |
| **Closed** | [ ] |

<a id="gap-f6-02"></a>

### GAP-F6-02 — Migration 029 only if prod lacks column

| | |
|---|---|
| **Brief** | F6 |
| **Snag** | No `029_products_barcode.sql` in repo |
| **Fix** | Run `npm run migration:sanity` on prod; add 029 only if column missing |
| **Closed** | [ ] |

---

## Ops (not code)

| ID | Task | Closed |
|----|------|--------|
| **GAP-O1-01** | External uptime on `/midnight/api/health` — see [docs/ops/UPTIME_MONITORING.md](../ops/UPTIME_MONITORING.md) | [ ] |
| **GAP-O2-01** | M4 restore drill + sign-off in `DISASTER_RECOVERY.md` | [ ] |
| **GAP-O3-01** | `pm2 startup` + `pm2 save` (+ optional reboot test) | [ ] |
| **GAP-M4-01** | Same as O2 — M4 DoD | [ ] |

**Consolidated checklist:** [docs/ops/OPERATOR_CHECKLIST.md](../ops/OPERATOR_CHECKLIST.md)

---

## Docs hygiene

| ID | Task | Closed |
|----|------|--------|
| **GAP-DOC-01** | `MASTER_EXECUTION_PLAN.md` §8 matches `BRIEF_STATUS.md` | [x] 2026-06-04 |
| **GAP-DOC-02** | `README.md` points to current wave (`WAVE11_LAUNCH`) | [x] 2026-06-10 |

---

## Suggested fix waves (optional)

| Batch | Gaps | Effort |
|-------|------|--------|
| **Snag sweep A** | U2-01 (doc), GAP-DOC, U5-02 sign-off | 1 hour |
| **Snag sweep B** | U1-01–03, U4-01–02 | 1–2 PRs |
| **Wave 8b** | U5-01, U5-03 | 1 PR |
| **Ops day** | O1, O2, O3, H1-01 | VPS only |
| **Wave 10** | E2-01, F6-01, U4-03–04 | As needed |
