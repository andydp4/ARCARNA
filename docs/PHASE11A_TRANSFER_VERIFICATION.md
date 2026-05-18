# Phase 11A — Transfer & Per-Location Stock Verification

## Prerequisites

1. Apply migration `migrations/005_phase11a_location_stock_transfers.sql`
2. Run backfill: `npx tsx scripts/backfill-product-location-stock.ts`
3. Org has at least two active locations and products with stock at source location

## Happy-path lifecycle

1. **Create** `POST /api/inventory/transfers` — status `draft`, no stock change
2. **Request** `PATCH .../status` `{ "status": "requested" }`
3. **In transit** `{ "status": "in_transit" }`
4. **Complete** `{ "status": "completed" }` — source decrements, destination increments, `inventory_movements` with `transfer_out` / `transfer_in`, `transferId`, location ids

## Invalid transition matrix

| From | Allowed | Rejected examples |
|------|---------|-------------------|
| draft | requested, cancelled | completed, in_transit |
| requested | in_transit, cancelled | completed, draft |
| in_transit | completed, cancelled | requested, draft |
| completed | — | any |
| cancelled | — | any |

API returns `{ code, message, details }` with HTTP 400/409 as appropriate.

## Insufficient-stock safety

1. Create transfer with quantity greater than source `product_location_stock`
2. Advance to `in_transit`, then `completed`
3. Expect HTTP **409** `INSUFFICIENT_STOCK`
4. Verify: destination stock unchanged, source unchanged, no partial movements, transfer remains `in_transit`

## Duplicate-complete protection

1. Complete a transfer successfully
2. Retry `completed` (or race duplicate) — expect `ALREADY_COMPLETED` (409)
3. `executionKey` on scheduled reports is separate; transfers use status guard + transactional completion

## RBAC checks

| Role | List/GET | Create/PATCH status |
|------|----------|---------------------|
| SUPER_ADMIN (with X-Org-Id) | Yes | Yes |
| ADMIN / MANAGER | Yes | Yes |
| CASHIER | Yes | **403** on mutate |

UI: CASHIER sees read-only banner on Transfers tab.

## Audit integrity checks

After successful completion, for each line item:

- One `transfer_out` movement at source (`delta` negative, `locationId` = source, `transferId` set)
- One `transfer_in` movement at destination (`delta` positive)
- `previousStock` / `newStock` populated on movements
- `products.stock` remains **0** (legacy placeholder only)

## Stock write-path migration checks

| Path | Uses `adjustProductLocationStock` |
|------|-----------------------------------|
| InventoryWorker (orders) | Yes |
| Manual PATCH `/api/inventory/:id` | Yes |
| Product import | Yes |
| Order delete restore | Yes |
| Transfer complete | Yes |
| Domain engine place/update order | No direct write (events) |
| `storage.createOrder` legacy | Removed |

## Known risks

- **Backfill required** — without backfill, on-hand may read as 0 until rows exist in `product_location_stock`
- **Location resolution** — orders without `locationId` and no user default require org default location
- **Double event processing** — InventoryWorker idempotency via `eventId` on movements; do not also call `reserveStock` on place order (removed from engine)
- **Apps Drizzle schema** — `apps/server/src/db/schema` does not list `product_location_stock`; server `shared/schema` + migration is authoritative
