# Release Checklist

Short, brutal, usable. Run through before each release.

**Preflight (migration sanity + gate):** `npm run release:preflight` (requires `DATABASE_URL`)

## 1. Required Env Vars

| Var | Purpose |
|-----|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Session encryption (production) |
| `NODE_ENV` | Set to `production` in production |

## 2. Migration Order

**Fresh DB:** `npm run db:push`

**Existing DB with analytics:** Run migration sanity check first:
```bash
DATABASE_URL=... npx tsx scripts/migration-sanity-check.ts
```

Then follow printed instructions:
- **Single org (or none):** `psql $DATABASE_URL -f migrations/001_analytics_org_pk.sql`
- **Multiple orgs:** `psql $DATABASE_URL -v org_id=YOUR_ORG_UUID -f migrations/001_analytics_org_pk_with_org.sql` (per org)

**Do NOT** use `drizzle push` blindly on DBs with existing analytics; it can conflict with the org-scoped PK migration.

## 3. Gate

```bash
npm run gate
```

Must pass (TypeScript, production-hooks check, Phase 2D seed + tests if `DATABASE_URL` set).

## 4. Smoke Tests (Manual)

1. **Login as CASHIER** – Confirm 403 on admin routes (`/api/admin/*`, `POST/DELETE /api/locations`)
2. **Cross-org** – As Cashier Org A, `GET /api/products/:id` for Org B product → 404
3. **SUPER_ADMIN scope** – Without `X-Org-Id`, scoped routes return 403

## 5. Rollback

**Migrations:** No automated rollback. Restore from DB snapshot if needed.

**Code:** Revert to previous tagged commit and redeploy.
