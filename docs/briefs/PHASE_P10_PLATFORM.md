# Phase P10 — Platform tooling

Maps architecture review **P10** to executable briefs. Feature flags (**M3**) and optional backend Sentry (**S8**) are already on `main`.

Execute **P10a** early (Wave 1); **P10d** before **U5** (a11y uses Playwright).

---

## Brief P10a — Sentry frontend + production DSN checklist

**Goal:** Client exceptions reach Sentry; operators know required env vars.

**Touch:**

- `+ client/src/lib/sentry.ts` — init when `VITE_SENTRY_DSN` set
- `~ client/src/main.tsx` — call init before render
- `~ .env.production.example` — `VITE_SENTRY_DSN`, sample rate
- `~ docs/SECURITY_REVIEW.md` — observability env vars

**Out of scope:** Performance tracing tuning.

**DoD:** Throw test error in staging → event in Sentry. Build passes without DSN (no-op).

**PR title:** `feat(observability): Sentry browser SDK (P10a)`

---

## Brief P10b — Product analytics (PostHog or Plausible)

**Goal:** Privacy-conscious usage analytics, org-scoped where possible, env-gated.

**Touch:**

- `+ client/src/lib/analytics.ts` — thin wrapper; no PII in event props by default
- `~ client/src/main.tsx` — init when `VITE_ANALYTICS_*` set
- `+ docs/ANALYTICS.md` — what's tracked, opt-out, GDPR note

**Out of scope:** Server-side funnel DB.

**DoD:** Page views on dashboard/POS in dev project; disabled when env unset.

**PR title:** `feat(analytics): Plausible or PostHog integration (P10b)`

---

## Brief P10c — Renovate

**Goal:** Automated dependency update PRs with safe defaults.

**Touch:**

- `+ renovate.json` — npm, grouping patches, automerge dev-deps optional
- `~ docs/briefs/README.md` — note Renovate policy

**DoD:** First Renovate PR opens on repo (or config validated locally).

**PR title:** `chore: Renovate config (P10c)`

---

## Brief P10d — Playwright E2E + CI

**Goal:** Smoke tests for sign-in path, POS load, health; foundation for U5 axe tests.

**Touch:**

- `+ playwright.config.ts`
- `+ tests/e2e/smoke.spec.ts` — health, optional auth with test Clerk user
- `~ .github/workflows/ci.yml` — `playwright install` + run on PR (or nightly if flaky)

**Out of scope:** Full regression of every page.

**DoD:** `npx playwright test` green locally with `DATABASE_URL` test DB or mocked health-only job.

**PR title:** `test(e2e): Playwright smoke suite in CI (P10d)`

---

## Brief P10e — Cloudflare / edge runbook

**Goal:** Document how viger.cloud uses Cloudflare (DNS, SSL, cache rules) and what must not be cached for `/midnight/api/*`.

**Touch:**

- `+ docs/ops/CLOUDFLARE.md`
- `~ deploy/nginx-viger.cloud.conf.example` — cross-link

**Out of scope:** Terraform for CF.

**DoD:** Operator can answer “why 403 on sign-out” and “cache bust API” from doc.

**PR title:** `docs(ops): Cloudflare edge runbook (P10e)`
