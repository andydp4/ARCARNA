# Launch smoke test checklist

Run after deploy using [DEPLOYMENT_HOSTINGER_VPS.md](./DEPLOYMENT_HOSTINGER_VPS.md) and [AUTH_SETUP_CLERK.md](./AUTH_SETUP_CLERK.md). Mark each item pass/fail.

## Access & auth (Clerk)

- [ ] Landing page shows **Sign in** (not Replit) when `AUTH_PROVIDER=clerk`
- [ ] Clerk sign-in completes (`/sign-in` → dashboard)
- [ ] **First user** becomes SUPER_ADMIN automatically (no prior owner)
- [ ] Second user without approval lands on **pending approval** (`/pending-approval`)
- [ ] SUPER_ADMIN approves user in **User access**
- [ ] Approved user can sign in and reach dashboard
- [ ] Org setup wizard completes (`/setup-wizard`)
- [ ] SUPER_ADMIN can switch org (`OrgSwitcher` + `X-Org-Id` scope)
- [ ] CASHIER cannot access admin mutations (rules, user access, draft create)

## Catalog & customers

- [ ] Create product (Products page)
- [ ] Import product CSV (Settings → Imports)
- [ ] Create customer

## POS & invoicing

- [ ] POS order completes
- [ ] Invoice/PDF generated (pdfkit path)

## Inventory intelligence

- [ ] Smart Stock tab loads (`/inventory` → Smart Stock)
- [ ] Stock levels reflect `product_location_stock` (after install backfill)

## Suppliers & replenishment

- [ ] Supplier created (Settings → Suppliers)
- [ ] Product–supplier mapping saved
- [ ] Replenishment recommendation appears (`/inventory` → Replenishment)
- [ ] Purchase draft created from replenishment (draft only — no supplier send)

## Purchase → receive → stock

- [ ] Purchase draft: `draft` → `reviewed` → `approved` (internal only)
- [ ] **Approve does not** increase stock
- [ ] Goods receipt created (pending)
- [ ] Receipt **completed** → stock increases at location
- [ ] Purchase draft shows `partially_received` or `fully_received`
- [ ] Cancelled draft cannot receive
- [ ] Fully received draft cannot delete lines

## Transfers

- [ ] Transfer draft created between locations
- [ ] Transfer completed moves stock (no duplicate completion)

## Automation UI

- [ ] Rules page loads (`/rules`)
- [ ] Scheduled reports page loads (`/scheduled-reports`)

## API health

- [ ] `GET /api/health` returns `{ ok: true }`

## Production safety

- [ ] `DEV_AUTH_BYPASS=0` in `.env.production` (app refuses `1`)
- [ ] `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` set when using Clerk
- [ ] `SESSION_SECRET` set (32+ chars)
- [ ] `npm run gate` passed in CI/staging with `DATABASE_URL` when possible

## Existing Replit users (phased migration)

- [ ] Staff email on `allowed_users` before first Clerk login
- [ ] After Clerk login, access preserved (or run `npm run auth:link-clerk` manually)
