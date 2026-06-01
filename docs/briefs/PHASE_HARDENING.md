# Phase H — Stabilise gaps (S6 / S7 / S8 / P6 finish)

Work here closes items from the architecture review that shipped **partially** on `main`. Do not duplicate M1–M4 or S1–S5.

---

## Brief H1 — Finish S6: tiered rate limits + CSP/HSTS + deploy docs

**Goal:** HTTP-layer hardening matches the S6 brief: stricter limits on auth and imports, documented HSTS at the edge, and a Clerk-safe CSP strategy (nginx and/or Node).

**Touch:**

- `~ server/index.ts` or `+ server/security.ts` — extract `applySecurityMiddleware`; add `authLimiter`, `importLimiter` per S6 plan
- `~ deploy/nginx-viger.cloud.conf.example` — `add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;`
- `~ docs/DEPLOY_HOSTINGER_VPS.md` — subsection “HTTP security headers” (what nginx vs Node sets)
- `~ docs/SECURITY_REVIEW.md` — reference H1 limits and CSP approach

**Steps:**

1. Global `/api` limiter stays; add `/api/auth` (20/min) and `/api/*/import` (5/min) limiters mounted before routes.
2. CSP: either (a) nginx CSP for static assets only, Node CSP off for Vite, or (b) helmet CSP with Clerk domains + `'unsafe-inline'` for boot script — test `/midnight/sign-in`.
3. Document HSTS on nginx; verify `curl -sI https://viger.cloud/midnight/api/health` shows HSTS when deployed.
4. `npm run check && npm test`.

**Out of scope:** WAF rules (Cloudflare — P10e). SUPER_ADMIN MFA (done).

**DoD:**

- 25 rapid POSTs to an auth path → 429 after threshold.
- Deploy doc lists HSTS + rate-limit policy.
- Clerk sign-in works (no CSP console errors).

**Verification:** Manual sign-in + `curl` header check on production after deploy.

**PR title:** `feat(security): tiered rate limits + HSTS/CSP docs (H1)`

---

## Brief H2 — Finish S7: audit retention + secret rotation runbook

**Goal:** Admin audit trail has a documented 7-year retention policy; operators have a rotation runbook for Clerk, DB, and session secrets.

**Touch:**

- `+ docs/SECRET_ROTATION_RUNBOOK.md` — Clerk keys, `DATABASE_URL`, session secret, `RESEND_API_KEY`, webhook signing secrets
- `~ docs/SECURITY_REVIEW.md` — link runbook; retention policy
- Optional: `+ migrations/014_admin_audit_retention.sql` — `retention_until timestamptz default now() + interval '7 years'` on `admin_audit_logs` (no purge job required in H2)

**Steps:**

1. Write runbook: who rotates, how often, blast radius, verification after rotate.
2. Document retention: append-only logs kept 7 years; export/archival note for compliance.
3. If column added: backfill `retention_until` for existing rows.

**Out of scope:** Automated purge/archival to cold storage.

**DoD:**

- Runbook merged; SECURITY_REVIEW links it.
- Retention policy stated in both docs.

**PR title:** `docs(security): audit retention policy + secret rotation runbook (H2)`

---

## Brief H3 — Finish S8: extended health metrics

**Goal:** `/api/health/metrics` exposes outbox pending, dispatched count, dead-letter count, and oldest pending event age for monitoring.

**Touch:**

- `~ server/routes/health.ts` — extend SQL queries
- `~ docs/SECURITY_REVIEW.md` — list metrics for alerting
- Optional: gate behind `requireSuperAdmin` if metrics are considered sensitive (plan allowed public scrape — pick one and document)

**Steps:**

1. Add counts: `event_outbox` by status (`pending`, `dispatched`), `dead_letters` count, `max(now() - created_at)` for oldest pending.
2. Return JSON: `{ ok, db, outboxPending, outboxDispatched, deadLetterCount, oldestPendingSeconds, jobQueued }`.
3. Document suggested alert thresholds in SECURITY_REVIEW or O1 brief.

**Out of scope:** PagerDuty integration (O1). Email/Slack from app.

**DoD:**

- `curl /midnight/api/health/metrics` returns all fields ≥ 0.
- CI still green.

**PR title:** `feat(observability): extended outbox/DLQ health metrics (H3)`

---

## Brief H4 — P6: STORAGE_STRATEGY.md (documentation)

**Goal:** Written strategy for object storage before Files/Backups portal goes live.

**Touch:**

- `+ docs/STORAGE_STRATEGY.md` — R2/S3 choice, org-prefixed keys, max object size, MIME allowlist, virus scan hook (future), retention, backup vs user uploads

**Steps:**

1. Define bucket layout: `{orgId}/uploads/`, `{orgId}/exports/`, platform backups separate.
2. Reference M4 Neon→R2 backup scripts vs future user Files.
3. Note: rate limits on upload routes deferred until portal API exists (link H1 pattern).

**Out of scope:** Implementing Files API or portal backend.

**DoD:** Doc reviewed; linked from `ARCHITECTURE_DOMAIN_MAP.md` or `README` briefs index.

**PR title:** `docs: STORAGE_STRATEGY for Files/Backups (H4)`
