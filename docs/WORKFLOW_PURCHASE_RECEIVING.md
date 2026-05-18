# Purchase & receiving workflow audit (Phase 12)

## Lifecycle

```
Replenishment recommendation (read-only)
  → Purchase draft (draft)
  → Reviewed → Approved (internal only)
  → Goods receipt (pending)
  → Goods receipt completed → stock increase
```

## Status matrix

| Purchase draft status | Can edit lines? | Can approve? | Can receive? | Stock impact |
|----------------------|-----------------|--------------|--------------|--------------|
| draft | Yes | → reviewed | No | None |
| reviewed | Yes | → approved | No | None |
| approved | No | → cancelled* | Yes | None until receipt complete |
| partially_received | No | → cancelled* | Yes (remaining qty) | Prior completions only |
| fully_received | No | No | No | Final |
| cancelled | No | No | No | None |

\*Cancelled only if no **pending** goods receipts exist.

Receiving statuses (`partially_received`, `fully_received`) are set **only** by completing goods receipts — not via manual status buttons.

## Stock rules (enforced in code)

- **Only** `POST /api/goods-receipts/:id/complete` increases `product_location_stock`
- Purchase draft approval does **not** move stock
- Purchase replenishment draft creation does **not** move stock
- Transfer completion moves stock between locations (separate path)
- Damaged quantity on receipts is recorded but does **not** add to sellable stock

## Out of scope (confirmed)

- Supplier email / PO send
- Payment / AP
- Landed costs
- Barcode scanning
- Accounting integrations

## Phase 12 hardening applied

- Block manual status transition to `partially_received` / `fully_received`
- Block cancel when pending receipts exist
- Block delete except `draft` / `reviewed`
- Block header edit after approval
- UI copy clarifies approval vs receiving boundaries
- Receiving history on purchase draft detail; purchase draft link on receipt detail
