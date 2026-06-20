# WM Supplies Website

The WM Supplies customer-facing website is an Arcana extension, not a separate ecommerce system. Arcana owns the content, product visibility, order settings, and eventual order-tray integration.

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

Public order payloads deliberately reject client-supplied totals. Prices must be resolved and calculated server-side when the public order API is implemented.

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
