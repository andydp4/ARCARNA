# Wave 11 — Next work

**Status:** Agent 1 **merged** (PR **#32**). Deploy + QA: [`WAVE11_LAUNCH.md`](./WAVE11_LAUNCH.md).

**Prerequisite:** Wave 10 on `main` (through PR **#31** — Clerk JWT session sync; PWA SW fix on `main`; WhatsApp, logo, ops docs).

**Preflight:** `npm run wave10:preflight`

---

## 1. Scope table

| Brief ID | Branch name | Depends on | Migration file |
|----------|-------------|------------|----------------|
| **E2** (setup wizard shell) | `feat/e2-setup-wizard-shell` | **E1** tokens; `onboarding.tsx` / `onboarding-wizard.tsx` already use `lm-auth-shell` | — |
| **U5** (lint strict) | `chore/lint-strict-pass` | Wave 8b eslint infra on `main` | — |
| **U1** (import chrome) | `feat/u1-import-empty-states` | [GAP-U1-03](./GAPS_BACKLOG.md#gap-u1-03) | — |
| **Ops** | — (operator) | O1–O3 — [`OPERATOR_CHECKLIST.md`](../ops/OPERATOR_CHECKLIST.md) | — |

---

## 2. Agent 1 — Setup wizard Liquid Metal (E2 remainder)

**Goal:** Match `setup-wizard.tsx` to the Liquid Metal auth/onboarding shell so org setup feels consistent with `/onboarding` and `/onboarding/wizard`.

**Touch:**

- `~ client/src/pages/setup-wizard.tsx` — `lm-auth-shell liquid-metal` on loading + page shell; `lm-card` on step card; `text-metal-warm-white` / `text-metal-muted` on headings
- `~ docs/briefs/GAPS_BACKLOG.md` — close setup-wizard E2 snag (if listed)
- `~ docs/briefs/WAVE11_NEXT.md` — this file

**Steps:**

1. Wrap loading and main layout in `min-h-screen lm-auth-shell liquid-metal` (mirror `onboarding-wizard.tsx`).
2. Replace default `bg-background` / `text-muted-foreground` chrome with metal tokens on the wizard header.
3. Apply `lm-card border-0 shadow-none` to the step `Card` (same pattern as onboarding wizard).
4. Do **not** change wizard logic, API calls, or step flow.
5. Run `npm run check && npm run build`.

**Out of scope:**

- Reskinning `inventory.tsx`, `reports.tsx`, `locations.tsx`, `user-access.tsx` (still `bg-background` — Wave 12+ or separate E2 PR).
- Import modal empty states (Agent 2 / GAP-U1-03).
- `lint:strict` (Agent 3).

**DoD:**

- [x] `/setup-wizard` (or post-onboarding redirect) shows Liquid Metal shell on desktop and mobile.
- [x] Loading spinner uses `lm-auth-shell` (no flash of white `bg-background`).
- [x] No regression in wizard steps, import, or complete flow.
- [x] `npm run check && npm run build` green.

**Verification:**

```bash
npm run check && npm run build
# Manual: SUPER_ADMIN or ADMIN → org with incomplete setup → setup wizard
# Visual: compare with /onboarding/wizard — same shell family
```

**PR title:** `fix(ui): Liquid Metal shell on setup-wizard (E2 remainder)`

---

## 3. Agent 2 — Import flow empty states (optional)

**Owns:** `client/src/components/import/*` — [GAP-U1-03](./GAPS_BACKLOG.md#gap-u1-03).

**PR title:** `feat(ui): empty states and skeletons on import modals (U1)`

---

## 4. Agent 3 — `lint:strict` (optional)

**Owns:** `npm run lint:strict` green on non-POS `client/**` per Wave 10 backlog.

**PR title:** `chore(lint): pass lint:strict on client (U5)`

---

## 5. Housekeeping

- [x] **PR #29** — closed (PWA SW already on `main`).
- [x] **PR #32** — merged Agent 1.
- [ ] **Deploy** — operator: [`WAVE11_LAUNCH.md`](./WAVE11_LAUNCH.md) § Deploy.

---

## 6. VPS deploy note

```bash
cd /root/MidnightEPOS
git pull origin main
source .env
npm ci && npm run build
bash scripts/apply-migrations-pm2.sh
pm2 restart midnight-epos --update-env
```

**Smoke after Agent 1:**

- New or existing org → setup wizard → Liquid Metal background + card
- Complete wizard → dashboard loads
- `GET /midnight/api/health` → `{"ok":true}`

---

## 7. Deferred to Wave 12+

| Area | Items |
|------|--------|
| **E2** | Remaining `bg-background` list pages (inventory, reports, locations, user-access) |
| **F** | Label printing, legacy gift-card import |
| **L1–L7** | Long horizon — [`MASTER_EXECUTION_PLAN.md`](./MASTER_EXECUTION_PLAN.md) §6 |
