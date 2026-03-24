# Phase 2B Migration Plan

## Schema vs DB Clarification

**shared/schema.ts** is the canonical Drizzle schema. Analytics tables have composite PKs including orgId. order_items and order_expenses have orgId (nullable until backfill + NOT NULL migration).

**Do NOT use `drizzle-kit push` for PK changes on existing DBs.** Use the manual migrations below.

---

## Existing DB: Ordered Migration Steps

### Step 0: Pre-flight (optional)
```sql
-- Count rows with null org_id (expect some before backfill)
SELECT 'analytics_daily' AS t, COUNT(*) FROM analytics_daily WHERE org_id IS NULL
UNION ALL SELECT 'analytics_weekly', COUNT(*) FROM analytics_weekly WHERE org_id IS NULL
UNION ALL SELECT 'analytics_monthly', COUNT(*) FROM analytics_monthly WHERE org_id IS NULL;
```

### Step 1: Analytics PK migration

**Pre-check (mandatory):** Run `SELECT COUNT(*) FROM organizations;`
- If 0 or 1: run `psql $DATABASE_URL -f migrations/001_analytics_org_pk.sql`
- If > 1: do NOT run 001. Use `psql $DATABASE_URL -v org_id=YOUR_ORG_UUID -f migrations/001_analytics_org_pk_with_org.sql` (operator must provide the org id for legacy analytics), or consolidate to single org first.

**Assumptions:**
- Default org: first row in `organizations`, or create "Default Organization" if none
- Collision: legacy single-tenant data → all rows get same default org_id
- Constraint names: `DROP CONSTRAINT IF EXISTS <name>` covers `_pkey` and `_year_week_pk` / `_year_month_pk`

### Step 2: Org backfill for order_items, order_expenses, etc.
Run: `npm run backfill` (or `npx tsx scripts/backfill-org.ts`)

**Idempotency:** Backfill only updates `WHERE org_id IS NULL`. Safe to run multiple times.

### Step 3: Safety check before NOT NULL
```sql
-- Must return 0 for all tables; otherwise do NOT run 002
SELECT 'products' AS t, COUNT(*) FROM products WHERE org_id IS NULL
UNION ALL SELECT 'customers', COUNT(*) FROM customers WHERE org_id IS NULL
UNION ALL SELECT 'orders', COUNT(*) FROM orders WHERE org_id IS NULL
UNION ALL SELECT 'order_items', COUNT(*) FROM order_items WHERE org_id IS NULL
UNION ALL SELECT 'order_expenses', COUNT(*) FROM order_expenses WHERE org_id IS NULL
UNION ALL SELECT 'invoices', COUNT(*) FROM invoices WHERE org_id IS NULL
UNION ALL SELECT 'locations', COUNT(*) FROM locations WHERE org_id IS NULL
UNION ALL SELECT 'loyalty_tiers', COUNT(*) FROM loyalty_tiers WHERE org_id IS NULL
UNION ALL SELECT 'promotions', COUNT(*) FROM promotions WHERE org_id IS NULL
UNION ALL SELECT 'overhead_expenses', COUNT(*) FROM overhead_expenses WHERE org_id IS NULL;
```

### Step 4: NOT NULL migration (gated)
Run: `psql $DATABASE_URL -f migrations/002_org_not_null.sql` **only after** Step 3 returns 0 for all tables.

---

## Insert Paths – orgId Set

| Path | orgId source |
|------|--------------|
| OrdersRepoDrizzle.save (order_items) | order.orgId |
| storage.createOrder (orders, order_items, order_expenses) | orderData.orgId |
| storage.createOrderExpenses | orgId param or lookup from order |

---

## Fresh Install

1. `npm run db:push`
2. `npm run seed`
3. No manual migration needed
