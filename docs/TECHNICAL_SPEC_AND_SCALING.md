# arcarna — Technical Specification & Scaling Guide

**Document type:** System requirements, deployment reference, and capacity-planning guide.
**Audience:** Whoever operates and scales the arcarna deployment.

> **How to read the scaling numbers.** The capacity tiers in §4 are **engineering estimates** derived from the system's architecture (a single Node.js process with in-process workers, backed by PostgreSQL) and typical Node/Postgres throughput — they are **not** measured benchmarks of this specific workload. Treat them as a starting point and a trigger list, and confirm with a load test against your real traffic before committing to a tier. Every assumption behind the numbers is stated so you can adjust them for your own usage.

---

## 1. What the system is, technically

- **Runtime:** Node.js (server bundled with esbuild to a single ESM file), Express 5.
- **Process model:** one long-running application process. The domain-event **workers run in-process** (inventory, invoice, loyalty, analytics, finance, receipt email, automation, business insights), consuming a database-backed outbox idempotently via a `processed_events` table. A reconciliation job re-queues stuck events on a timer.
- **Database:** PostgreSQL (Neon serverless or self-hosted Postgres 16). Schema managed from `shared/schema.ts` with raw SQL migrations in `migrations/`.
- **Client:** React PWA served as static assets; installs to device, caches an app shell, and queues orders offline in IndexedDB, syncing when back online. Offline caching **reduces** server read load.
- **Reverse proxy:** nginx terminates TLS and proxies to the app on `127.0.0.1:5000`.
- **Process manager:** PM2 (`arcarna-epos`), `NODE_ENV=production`.

**Scaling character.** Because the app process and its workers are a single unit, the default scaling path is **vertical** (a bigger box). The database is the first hard limit under load. Horizontal scaling (multiple app instances) is possible because state lives in Postgres and the outbox is idempotent, but it needs the operational changes noted in §5 — do not simply run two copies without them.

---

## 2. Minimum requirements to run

### 2.1 Server (application)

| Resource | Minimum (pilot / single shop) | Notes |
|----------|-------------------------------|-------|
| OS | Linux (Ubuntu 22.04+ / Debian 12+) | Also runs on any modern Linux |
| Node.js | 20 LTS or newer | 22.x tested |
| vCPU | 1 vCPU | 2 recommended even at pilot for headroom |
| RAM | 1 GB | 2 GB recommended; Node + build tooling are the consumers |
| Disk | 10 GB SSD | App + logs; database sized separately |
| Network | Stable outbound HTTPS | For Clerk, Resend, WhatsApp, Neon (if used) |

### 2.2 Database

| Resource | Minimum | Notes |
|----------|---------|-------|
| PostgreSQL | 16 | Neon serverless or self-hosted |
| vCPU / RAM | Shared / 1 GB | Grows with data volume and concurrency (see §4) |
| Disk | 10 GB SSD, growing | Retain audit logs 7 years; plan headroom |
| Connections | Pooled | The app uses a connection pool; keep pool ≤ Postgres `max_connections` |

### 2.3 Required services & credentials

- **Clerk** — authentication (`CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, accounts URL).
- **Resend** — transactional email (API key) for receipts/invoices.
- **WhatsApp Business API** (optional) — `WHATSAPP_*` including `WHATSAPP_APP_SECRET` (mandatory when enabled).
- **Object storage (optional)** — Cloudflare R2 for off-site database backups.

### 2.4 Required environment (production)

The app **fails fast at boot** if these are wrong, by design:
- `DATABASE_URL` — Postgres connection string.
- `SESSION_SECRET` — ≥ 32 characters.
- `CLERK_SECRET_KEY` — required when `AUTH_PROVIDER=clerk` (the default).
- `VITE_BASE_PATH` — `/` for a root-domain (subdomain) deployment.
- `NODE_ENV=production`, and `DEV_AUTH_BYPASS` must **not** be `1` (the process refuses to start otherwise).

### 2.5 Client (till / tablet / phone)

- Any modern browser (Chromium, Safari, Firefox) on a device with ≥ 2 GB RAM.
- Installable as a PWA; works offline for taking orders. Touch targets are 44px (56px at the till).

---

## 3. Deployment reference (self-hosted VPS)

```
# on the server, in the app directory (e.g. /root/ARCARNA)
git pull origin main
npm ci
npm run build                     # vite build + portal + esbuild server bundle
bash scripts/apply-migrations-pm2.sh   # applies migrations/*.sql in order
pm2 restart arcarna-epos          # or: pm2 start ecosystem.config.cjs && pm2 save
```

nginx proxies the domain to `127.0.0.1:5000`; TLS via Certbot; HSTS at the edge. Backups: Neon point-in-time recovery plus nightly logical dumps to R2 (`scripts/backup-neon-to-r2.sh`). **Test the restore at least quarterly** — an untested backup is a hypothesis, not a safety net.

---

## 4. Capacity planning & scaling tiers

### 4.1 What "users" means here

Capacity is driven less by the number of *named* user accounts and more by **concurrent active users** (staff with the app open and interacting), **orders per day**, and **organisations** (tenants). A deployment with 400 named users but 30 active at once behaves very differently from 400 all trading at 5pm on a Saturday. The tiers below quote **named users** as the headline (as commonly requested) but state the concurrency and order-volume assumptions each tier is sized for.

### 4.2 Methodology (how these numbers are derived)

- A single Node process comfortably handles hundreds of lightweight requests per second; the practical limit here is the **workers + database**, not the HTTP layer.
- Assume **~10% of named users are concurrently active** in normal retail patterns, with short bursts to ~25% at peak trading.
- Assume an active user issues on the order of **a few requests per interaction** and places/serves orders intermittently; the PWA caches reads, so steady-state read load is modest.
- Assume each order triggers ~8 worker jobs (inventory, invoice, loyalty, analytics, finance, receipt, insights, automation), each a small transactional DB write.
- The **database connection pool** and Postgres CPU are the first constraints as concurrency rises.

Adjust upward if your traffic is spikier (e.g. many tills all closing shifts at once), if orgs run large catalogues/imports, or if analytics windows are large.

### 4.3 Tiers

| Tier | Named users | Assumed concurrent active | Orders/day | App server | PostgreSQL | Architecture |
|------|-------------|---------------------------|-----------|------------|------------|--------------|
| **0 · Pilot** | ≤ 25 | ≤ 5 | ≤ 500 | 1–2 vCPU, 2 GB | Shared / 1–2 GB, ~20 conns | Single instance (current) |
| **1 · Small** | ≤ 50 | ~10 | ≤ 2,000 | 2 vCPU, 4 GB | 2 vCPU, 4 GB, ~40 conns | Single instance |
| **2 · Growing** | ~100–200 | 20–40 | ≤ 8,000 | 4 vCPU, 8 GB | 4 vCPU, 8 GB, ~80 conns | Single app instance; **workers still in-process** but monitor outbox lag |
| **3 · Busy** | ~400 | 40–100 | ≤ 20,000 | 4–8 vCPU, 8–16 GB | 4–8 vCPU, 16 GB, ~120–150 conns, read replica optional | Consider splitting the **worker process** from the web process (see §5.1); add PgBouncer |
| **4 · Large** | 1,000+ | 100–300+ | 50,000+ | 2–4 app instances behind a load balancer, 4 vCPU / 8 GB each | 8+ vCPU, 32 GB+, PgBouncer, read replica(s) | Horizontal web tier + dedicated worker tier + connection pooling (see §5) |

**Reading the table for the "400 users" case (Tier 3):** budget roughly **4–8 vCPU and 8–16 GB RAM for the application**, a **dedicated Postgres of 4–8 vCPU and ~16 GB RAM** with a connection pooler (PgBouncer) and ~120–150 pooled connections, and plan to move the event workers into their own process so a burst of background jobs (e.g. many shifts closing at once) can't slow the till. A read replica becomes worthwhile here for the analytics/Truths queries.

### 4.4 What actually breaks first, and the signals to watch

Scale in response to **signals**, not just user counts. Watch the health metrics exposed at `GET /api/health/metrics`:

| Signal | Meaning | Suggested action threshold |
|--------|---------|---------------------------|
| `outboxPending` rising | Workers can't keep up with events | > 100 sustained → split worker process / add DB capacity |
| `oldestPendingSeconds` | Oldest unprocessed event age | > 300s → investigate worker/DB |
| `deadLetterCount` increasing | Events repeatedly failing | Any sustained rise → investigate |
| `jobQueued` | Backlog of queued jobs | > 500 → add capacity |
| Postgres CPU > 70% sustained | DB is the bottleneck | Bigger DB, add read replica, add PgBouncer |
| App event-loop lag / p95 latency rising | App CPU-bound | More vCPU, then split web/worker, then horizontal |
| Connection pool exhaustion errors | Too many concurrent DB users | Add PgBouncer; raise pool within Postgres `max_connections` |

---

## 5. Scaling out (beyond a single box)

The app is designed so this is possible, but it requires deliberate changes — do not just run two copies.

### 5.1 Split the workers from the web tier (first horizontal step)

The web process and the workers currently run together. At Tier 3+, run the workers as a **separate process/instance** pointed at the same Postgres. Because the outbox uses `processed_events` for idempotency and a reconciliation job re-queues stuck events, the workers can run independently of the web tier. This isolates background load (bulk imports, mass shift closes, analytics recomputes) from customer-facing request latency.

### 5.2 Multiple web instances

Run 2+ stateless web instances behind a load balancer. Requirements:
- **Sessions/auth** are Clerk-hosted (stateless JWT), so no sticky sessions needed for auth.
- Ensure only **one** worker runner is active (or that workers are safe to run in multiples — they are idempotent, but running many increases DB contention; prefer a single dedicated worker tier).
- Put **PgBouncer** in front of Postgres so many instances share a bounded connection pool.

### 5.3 Database scaling

- **PgBouncer** (transaction pooling) as soon as concurrent connections approach Postgres limits.
- **Read replica(s)** for analytics/Truths and reporting reads, keeping the primary for writes.
- Ensure hot-path indexes are present (they are: `org_id` on orders/customers/invoices/order_items, `order_id` on order_items/invoices, plus shift/cashier indexes). Add indexes as new query patterns emerge; verify with `EXPLAIN` under production-like data.
- Partition the largest append-only tables (orders, order_items, inventory_movements, admin_audit_logs) by time only if they grow into the tens of millions of rows.

### 5.4 Other load reducers

- The **PWA offline cache** already offloads reads to the client — keep it enabled.
- **Response compression** is enabled server-side.
- Serve static client assets via nginx/CDN, not the Node process, at higher tiers.
- Rate limits are tiered (global API, auth, import) and protect against runaway load.

---

## 6. Availability, backup & recovery

- **Backups:** Neon PITR + nightly logical dumps (`pg_dump --format=custom`) to Cloudflare R2, 30-day retention. Restore script provided.
- **Recovery drill:** run a restore into a scratch database at least quarterly and compare row counts to production within ~1%. Record the result. This is the single most important operational habit.
- **Monitoring:** scrape `GET /api/health` and `GET /api/health/metrics` (public, suitable for uptime monitors) and alert on the §4.4 thresholds. Optional Sentry for error tracking (`SENTRY_DSN`).
- **Zero-downtime deploys:** at single-instance tiers, `pm2 restart` causes a brief blip; the PWA's offline queue means tills keep taking orders through it. At horizontal tiers, roll instances one at a time behind the load balancer.

---

## 7. Security posture (operational summary)

- TLS everywhere; HSTS at the nginx edge.
- Helmet security headers in production; tiered rate limiting on API/auth/import.
- Clerk-hosted auth; MFA enforced for super-admin on sensitive routes.
- Strict per-tenant data isolation (`org_id` on every scoped query; fail-closed org-scope middleware).
- Append-only admin audit log (7-year retention).
- Secrets only via environment; production boot validates required secrets and refuses unsafe configurations (e.g. dev auth bypass).
- WhatsApp webhook HMAC verification mandatory when enabled.

For the full threat model and security review, see `docs/SECURITY_REVIEW.md`.

---

*These figures are estimates to guide provisioning and to define when to act. Validate against a load test with your own traffic profile before committing budget, and scale in response to the §4.4 signals rather than to user-count alone.*
