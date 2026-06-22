# WM Supplies Website

The WM Supplies customer-facing website is an invite-only Arcana extension, not a separate ecommerce system. Arcana owns the content, product visibility, account approval, order settings, and eventual order-tray integration.

Customers must sign in with Clerk and be approved in Arcana before they can see homepage content, products, or the order form.

## Phase 1 Schema Foundation

Migration:

`migrations/038_wm_supplies_website_foundation.sql`

Development Neon branch:

`br-purple-king-abrrcv37` (`wmsupplies-website-dev`)

This migration adds:

- `website_uploaded_files`
- `website_theme_settings`
- `website_order_settings`
- `website_blocks`
- website visibility and display metadata on `products`

It also seeds one theme settings row and one order settings row for each existing organization.

## Product Fields

The public website should only list products where `products.available_for_website = true`.

The public product projection must not expose internal pricing, cost, supplier, margin, or raw stock internals.

## Order Status Mapping

The brief's "Pending confirmation" state is mapped to the existing Arcana `pending` order status for the first integration slice. The UI can show a Website badge/source separately through `orders.channel = 'web'`.

Adding a brand-new order status later requires updating:

- `ORDER_STATUSES` in `shared/schema.ts`
- order tray grouping and status labels
- order status validation tests
- any analytics or worker logic that branches on order status

## Recovery Path

For the development branch, use Neon branch reset if the schema needs to be discarded.

For a manual rollback on a non-production test database:

```sql
DROP TABLE IF EXISTS website_blocks;
DROP TABLE IF EXISTS website_order_settings;
DROP TABLE IF EXISTS website_theme_settings;
DROP TABLE IF EXISTS website_uploaded_files;

ALTER TABLE products
  DROP COLUMN IF EXISTS website_image_file_id,
  DROP COLUMN IF EXISTS website_sort_order,
  DROP COLUMN IF EXISTS website_unit_label,
  DROP COLUMN IF EXISTS website_category,
  DROP COLUMN IF EXISTS website_description,
  DROP COLUMN IF EXISTS website_title,
  DROP COLUMN IF EXISTS available_for_website;
```

Do not run rollback SQL against production without a backup and explicit approval.

## Phase 2 Service Contract

Shared validation lives in:

`shared/website.ts`

Backend service logic lives in:

`server/services/website.ts`

This layer currently covers:

- theme patch validation
- block input validation
- upload metadata validation
- order settings validation
- public order payload validation
- default public site configuration
- hidden block filtering
- block and product sort order
- safe public product projection

Public order payloads deliberately reject client-supplied totals. Prices are resolved and calculated server-side by the public order submission service.

## Phase 3 Media Foundation

Media validation and the local storage provider live in:

`server/services/websiteMedia.ts`

The media foundation currently covers:

- JPG, PNG, and WebP MIME allowlist
- image magic-byte validation to reject fake files
- MIME/content mismatch rejection
- 10 MB image limit
- filename sanitisation and path traversal rejection
- org-scoped storage keys under `orgs/{orgId}/uploads/website/...`
- local save/delete provider for development and test use

R2/S3 and admin upload routes can be added on top of this provider interface without changing the validation rules.

## Phase 4 Backend API Wiring

Website API routes live in:

`server/routes/website.ts`

Repository/database wiring lives in:

`server/services/websiteRepository.ts`

Customer website API routes:

- `GET /api/public/wm-supplies/site-config`
- `GET /api/public/wm-supplies/products`
- `GET /api/public/products`
- `POST /api/public/wm-supplies/orders`

These routes are mounted behind Clerk authentication, Arcana allow-list approval, and org scoping. They resolve the organisation from the approved account context, or for `SUPER_ADMIN` testing from the scoped org header/query. `WM_SUPPLIES_ORG_ID` / `WM_SUPPLIES_WEBSITE_ORG_ID` remain the public-org fallback for route handlers and local service tests.

Protected staff routes:

- `GET /api/website/config`
- `PUT /api/website/theme`
- `PUT /api/website/order-settings`
- `POST /api/website/blocks`
- `PUT /api/website/blocks/:blockId`
- `POST /api/website/blocks/:blockId/duplicate`
- `DELETE /api/website/blocks/:blockId`
- `GET /api/website/uploads`
- `POST /api/website/uploads/metadata`

These routes use the existing scoped middleware from `server/routes.ts` and then require one of:

- `SUPER_ADMIN`
- `ADMIN`
- `MANAGER`

Admin mutations write admin audit entries. Public product responses are projected through the service layer and do not include cost price or other internal fields.

The upload metadata route records already-validated metadata only. Binary upload handling and R2/S3 provider support are separate follow-on tasks.

## Phase 5 Public Website and Order Intake

Customer-facing React routes live in:

`client/src/features/wm-supplies/WmSuppliesPublicSite.tsx`

Pure rendering/order helpers live in:

`client/src/features/wm-supplies/publicWebsite.ts`

Public routes inside the current Arcana mount:

- `/`
- `/order`
- `/order/success`

All three routes render a private account gate until Clerk auth and Arcana account approval pass. The frontend does not fetch site config, products, or order data before approval. The backend also rejects direct customer API calls without approved auth.

When no backend blocks are configured, the frontend renders a small bold fallback shop-window set. Once staff add visible homepage blocks, backend blocks take over.

Public order submission:

- validates payloads with `publicWebsiteOrderSchema`
- rejects client-supplied totals
- resolves products by `org_id` and `available_for_website = true`
- uses server-side `default_sale_price`
- creates customers with `source = 'website'`
- places orders through the domain engine
- persists `orders.channel = 'web'`
- publishes an `OrderCreated` outbox event with source `wm-supplies-website`

The first public order slice is deliberately conservative for stock: any shortage is rejected with `409`, even if the setting is enabled, until the inventory worker is adjusted to avoid unsafe deductions for out-of-stock website requests.

## Phase 6 Admin Website Manager

Staff website management now lives in:

`client/src/pages/settings/wm-supplies-website.tsx`

Shared admin form helpers live in:

`client/src/features/wm-supplies/adminWebsite.ts`

Routes:

- `/settings/wm-supplies-website`
- `/admin/wm-supplies/website`

The manager currently covers:

- overview counts and public-site link
- theme editing
- homepage block create/edit/hide/show/reorder/duplicate/delete
- media metadata listing and URL registration
- public order settings
- saved homepage preview with hidden blocks marked

Navigation entry points:

- Settings > Integrations > WM Supplies Website
- command palette entry `WM Supplies Website`

Verification for this phase:

- targeted website/admin helper tests
- full Vitest suite
- ESLint on touched client files
- targeted TypeScript checks for the client manager and API contract
- Vite production build

Rendered browser validation of the protected admin route requires a local `DATABASE_URL`/auth context. This clone does not currently contain a local `.env`, and the production secret that was pasted during planning should not be reused for local QA.

## Phase 7 Product Website Controls

Product website controls live in the existing product catalogue:

`client/src/pages/product-management.tsx`

Staff with `SUPER_ADMIN`, `ADMIN`, or `MANAGER` can open the Website action on a product and manage:

- show/hide on the WM Supplies website
- customer-facing title and description
- website category
- unit label
- sort order
- website image selection from registered website media

Backend route:

- `PATCH /api/products/:id/website`

The route is org-scoped, role-gated, validates payloads with `websiteProductSettingsPatchSchema`, writes only website display fields, and records a `website.product.updated` admin audit event.

## Phase 8 Website Order Visibility

Website orders use the existing Arcana order tray and are identified by `orders.channel = 'web'`.

Staff order management now shows:

- a Website count in the Orders summary cards
- a Channel filter with Website/POS/WhatsApp/Phone/API options
- a channel badge on each order row
- channel information in the order details dialog

The orders API includes `channel` on list and detail responses so website orders remain traceable without a separate order backend.

## Phase 9 Customer Account Approval

Migration:

`migrations/039_customer_website_role.sql`

The app now has a `CUSTOMER` role for approved website-only accounts.

Approval behaviour:

- pending Clerk sign-ups still land in User Access
- approving with `CUSTOMER` grants access to the private WM Supplies website only
- staff roles remain `CASHIER`, `MANAGER`, `ADMIN`, and `SUPER_ADMIN`
- staff-only APIs continue to require staff roles
- signed-in customers land on the WM Supplies website, not the Arcana staff dashboard

Use `CUSTOMER` for invited buyers unless the person should operate Arcana as staff.
