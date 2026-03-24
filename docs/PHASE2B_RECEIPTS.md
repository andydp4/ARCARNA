# Phase 2B Receipts

## 1. storage.ts – Single Definitions

**Interface (lines 146, 153, 161, 178):**
```
getLoyaltyTiers(orgId?: string | null): Promise<LoyaltyTier[]>;
getPromotions(active?: boolean, orgId?: string | null): Promise<Promotion[]>;
getOverheadExpenses(orgId?: string | null): Promise<OverheadExpense[]>;
getInvoicesWithDetails(orgId?: string | null): Promise<any[]>;
```

**Implementation (one each):**
```
878:  async getLoyaltyTiers(orgId?: string | null): Promise<LoyaltyTier[]> {
945:  async getOverheadExpenses(orgId?: string | null): Promise<any[]> {
1231:  async getPromotions(active?: boolean, orgId?: string | null): Promise<Promotion[]> {
1321:  async getInvoicesWithDetails(orgId?: string | null): Promise<any[]> {
```

No commented duplicates. No other implementations of these names in storage.ts.

---

## 2. Engine Path

**Routes do NOT call `storage.updateProduct` or `storage.updateCustomer`:**
- Grep: only `storage.updateProductStock` (line 564). No `storage.updateProduct` or `storage.updateCustomer`.

**Routes call engine after org pre-check:**
- PUT /api/products/:id: `storage.getProduct(id, ctx?.orgId)` → 404 if null → `engine.updateProduct(id, body)` (routes.ts:171–174)
- PUT /api/customers/:id: `storage.getCustomer(id, ctx?.orgId)` → 404 if null → `engine.updateCustomer(id, body)` (routes.ts:261–264)

**Engine now receives and enforces orgId in repos** (Phase 2B tightening):
- Routes pass `orgId` as third param to `engine.updateProduct`/`updateCustomer`/`deleteProduct`/`deleteCustomer`.
- ProductsRepoDrizzle/CustomersRepoDrizzle update/delete filter by `(id AND org_id)` when orgId provided; throw `'Product not found'`/`'Customer not found'` when 0 rows affected.
- Routes map those errors to 404. Pre-check (storage.getProduct/getCustomer) retained for defense in depth.

**createProduct / createCustomer – org-scoped via payload:**
- POST /api/products: `engine.createProduct({ ...req.body, orgId: ctx?.orgId })` (routes.ts:146)
- POST /api/customers: `engine.createCustomer({ ...req.body, orgId: ctx?.orgId })` (routes.ts:250)
- ProductsRepoDrizzle.create: `org_id: p.orgId ?? undefined` (repos.ts:108)
- CustomersRepoDrizzle.create: `org_id: c.orgId ?? undefined` (repos.ts:216)
- No direct storage inserts for products/customers from routes.

---

## 3. Migration 001 – Safety

**Tables:** analytics_daily, analytics_weekly, analytics_monthly (lines 8–10, 21–25, 37–43, 45–47).

**PK handling:**
- Drops old PK via `pg_constraint` for each table (lines 37–43)
- Creates new composite PKs: (org_id, date), (org_id, year, week), (org_id, year, month) (lines 45–47)

**Indexes:** No secondary indexes on analytics tables in shared/schema.ts. PK change replaces the PK-backed unique index. No extra index recreation.

**Backfill rule:** org_id = `SELECT id FROM organizations LIMIT 1`. If organizations is empty, `INSERT ... WHERE NOT EXISTS` creates "Default Organization" first (lines 13–15). All legacy analytics rows get that default org_id.

---

## 4. NOT NULL Gating

**002 fails hard if any NULLs:**
- DO block (migrations/002_org_not_null.sql lines 9–38) counts NULLs in each table and raises `RAISE EXCEPTION 'Cannot set NOT NULL: org_id NULLs remain...'` if any count > 0. Transaction aborts.

**Tables enforced:**
- products, customers, orders, order_items, order_expenses, invoices, locations, loyalty_tiers, promotions, overhead_expenses

---

## 5. Order Inserts – orgId

**orders.org_id:**
- OrdersRepoDrizzle.save (repos.ts:39): `org_id: orderWithOrg.orgId ?? null` on insert; update path does not change org_id.
- storage.createOrder (storage.ts:439): `orgId: orderData.orgId ?? orderData.org_id ?? null` on insert.
- Route POST /api/orders uses engine.placeOrder with `orgId: ctx.orgId` in body.

**order_items.org_id:**
- OrdersRepoDrizzle.save (repos.ts:27, 49): `org_id: orgId` (from order or existing row).
- storage.createOrder (storage.ts:454): `orgId` from orderData.
- No other insert paths.

**order_expenses.org_id:**
- storage.createOrder (storage.ts:467): `orgId` from orderData.
- storage.createOrderExpenses (storage.ts:984–990): `orgId` from param or lookup from order.
- OrdersRepoDrizzle does not insert order_expenses.
- createOrder / createOrderExpenses are not called from routes (orders use engine.placeOrder); these paths exist for other use.

---

## 6. Tick-Customers Scoping

**Org required:**
- All three endpoints use `...scoped` (requireOrgContext + requireOrgScope) (routes.ts:1304, 1351, 1373).
- requireOrgScope returns 403 when orgId is missing (replitAuth.ts).
- Tick-customers handlers now have explicit `if (!ctx?.orgId) return res.status(403)`.

**org_id in updates:**
- DELETE /api/tick-customers/:id: `whereCond = and(..., eq(orders.org_id, ctx.orgId))` (routes.ts:1359).
- POST /api/tick-customers/:id/mark-paid: same `whereCond` (routes.ts:1382).
- Fallback branch that omitted org_id has been removed.
