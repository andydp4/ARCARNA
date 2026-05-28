# Schema Evolution

How MidnightEPOS database schema changes are authored, reviewed, and applied. All contributors must read [ARCHITECTURAL_PRINCIPLES.md](./ARCHITECTURAL_PRINCIPLES.md) before changing schema.

---

## Policy

| Environment | Allowed | Forbidden |
|-------------|---------|-----------|
| **Local dev** | `drizzle-kit generate`, `npm run db:push` on disposable DBs | Pushing against a shared/staging DB without coordination |
| **CI** | `npm run check`, migration sanity scripts | `db:push` against production |
| **Production** | Ordered SQL via `scripts/apply-migrations-pm2.sh` | **`npm run db:push`** — never on production |

**Ordering:** Migrations live under `migrations/` as numbered SQL files. Production applies them in order via [`scripts/apply-migrations-pm2.sh`](../scripts/apply-migrations-pm2.sh) using `psql` against Neon.

**Rollback:** There are no automated down migrations. Roll back by restoring from Neon backup or writing a forward-fix migration. Document any manual step in the PR.

**Zero-downtime:** Single PM2 instance today — brief restart window is acceptable. For breaking changes, use expand/contract (below) across two releases.

---

## Applied schema

Migrations currently applied by `apply-migrations-pm2.sh`:

| File | Description |
|------|-------------|
| `001_analytics_org_pk_with_org.sql` | Analytics tables: composite PK including `org_id` for multi-tenant analytics |
| `002_org_not_null.sql` | Enforce `org_id` NOT NULL on org-owned tables after backfill |
| `003_org_setup_phase8.sql` | Org profile, setup wizard state, import history |
| `004_phase10_automation.sql` | Automation rules and execution metadata |
| `005_phase11a_location_stock_transfers.sql` | Per-location stock, transfers between locations |
| `006_phase11b_suppliers_replenishment.sql` | Suppliers, replenishment suggestions |
| `007_phase11c_goods_receiving.sql` | Goods receiving against purchase drafts |
| `008_auth_subject.sql` | Auth subject columns (`auth_user_id`, provider) on users / allow-list |
| `009_domain_outbox_and_workers.sql` | `domain_outbox` (legacy), `event_outbox`, `job_queue`, `processed_events`, `worker_run_logs`, `dead_letters` |

**Canonical Drizzle definitions:** [`shared/schema.ts`](../shared/schema.ts) must stay in sync with applied migrations.

### Deprecated (applied but do not write)

| Object | Status | Notes |
|--------|--------|-------|
| `domain_outbox` | **Deprecated** | Superseded by `event_outbox` (`server/eventBus.ts`). Retained for historical rows; will be dropped in a future migration after confirmation. |

---

## Reserved schema

**Status: Reserved** — documented here for channel-readiness work. Do **not** add these files to `migrations/` or apply to production until a brief promotes them to **Applied**.

### `orders.channel`

```sql
-- Promotion brief: C1
CREATE TYPE order_channel AS ENUM ('pos', 'web', 'whatsapp', 'phone', 'api');

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS channel order_channel NOT NULL DEFAULT 'pos';

COMMENT ON COLUMN orders.channel IS 'Sales channel attribution; default pos for in-store EPOS';
```

### `api_keys`

```sql
-- Promotion brief: C1
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS api_keys_key_hash_idx ON api_keys (key_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS api_keys_org_id_idx ON api_keys (org_id);
```

### `outbound_webhooks`

```sql
-- Promotion brief: C1
CREATE TABLE IF NOT EXISTS outbound_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  url VARCHAR(2048) NOT NULL,
  events TEXT[] NOT NULL,
  secret_hash VARCHAR(255) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS outbound_webhooks_org_id_idx ON outbound_webhooks (org_id);
```

Optional companion table for delivery logging (promote with C4):

```sql
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL REFERENCES outbound_webhooks(id) ON DELETE CASCADE,
  event_id VARCHAR(36) NOT NULL,
  status_code INTEGER,
  response_ms INTEGER,
  response_body TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS webhook_deliveries_webhook_created_idx
  ON webhook_deliveries (webhook_id, created_at DESC);
```

---

## Expand / contract pattern

Use this for non-trivial column or type changes to avoid downtime and broken deploys:

1. **Expand** — Add new column/table (nullable or with default). Deploy code that writes both old and new.
2. **Backfill** — One-off script or migration `UPDATE` to populate new column.
3. **Switch reads** — Deploy code that reads new column only.
4. **Contract** — Drop old column in a **later** migration after at least one release with no readers.

Never rename in place on production; add new + backfill + drop old.

---

## Authoring a new migration

1. Add `migrations/NNN_short_description.sql` with `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` where safe.
2. Update `shared/schema.ts` to match.
3. Append the file to the list in `scripts/apply-migrations-pm2.sh`.
4. Add a row to the **Applied schema** table in this document.
5. Run on a copy of production data or staging before production apply.
6. Update [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) if deploy steps change.

---

## See also

- [ARCHITECTURAL_PRINCIPLES.md](./ARCHITECTURAL_PRINCIPLES.md)
- [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md)
- [DEPLOY_HOSTINGER_VPS.md](./DEPLOY_HOSTINGER_VPS.md)
