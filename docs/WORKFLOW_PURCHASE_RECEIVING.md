# Purchase & receiving workflow audit (Phase 12)

## Lifecycle

```
Replenishment recommendation (read-only, net of stock already on order)
  → Purchase draft (draft) — one per supplier + location
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

## On-order netting (replenishment ↔ purchasing)

Replenishment nets off stock that is already on order, so acting on a
recommendation clears it instead of leaving the same shortfall on screen:

```
grossRequiredQty = max(0, ceil(velocity × coverageDays) − stock)
onOrderQty       = Σ (quantity − quantityReceived) over OPEN drafts, per product+location
requiredQty      = max(0, grossRequiredQty − onOrderQty)
```

`OPEN` means `draft`, `reviewed`, `approved` or `partially_received`
(`OPEN_PURCHASE_DRAFT_STATUSES`). Unapproved drafts deliberately count — that is
what stops a second click from raising a duplicate order. The trade-off is that
an abandoned draft keeps suppressing its recommendation, so it is made visible
rather than silent:

- an "N on order" badge on the recommendation card, and a note in **Why?**
- `summary.onOrder` counts affected recommendations
- cancelling or deleting the draft restores the recommendation immediately
- creating a draft warns when an open draft already exists for that
  supplier + location (`existingOpenDrafts` in the batch response)

Both `grossRequiredQty` and `onOrderQty` are returned alongside `requiredQty` so
the UI can show the gap, the cover, and the remainder separately. Pack-size and
minimum-order rounding apply **after** netting.

## Grouping (recommendations → drafts)

`POST /api/replenishment/create-purchase-drafts` takes many recommendation lines
and creates **one draft per supplier + location**, in a single transaction —
selecting a day's worth of recommendations yields one draft per supplier, not one
per line. Duplicate products within a group are summed. Supplier cost price and
supplier SKU are carried onto the draft lines.

Each draft records only the recommendations behind **its own** lines in
`sourceRecommendationJson` (`{ recommendations: [...] }`), surfaced as "Why this
was ordered" on the draft detail. `POST /api/replenishment/create-purchase-draft`
(singular) remains for a single-line draft and stores that recommendation
directly.

## Navigating the flow

Each hop carries the record's id in the URL, so the chain is clickable in both
directions (`client/src/lib/deepLink.ts`):

| Link | Target |
|------|--------|
| Draft created from replenishment | `/purchase-drafts?draft=<id>` |
| Receipt from a purchase draft | `/inventory?tab=receiving&receipt=<id>` |
| Purchase draft from a goods receipt | `/purchase-drafts?draft=<id>` |

The Inventory tabs are URL-driven (`?tab=`), so a receiving link lands on the
Receiving tab rather than Stock levels. A consumed deep-link param is stripped
via `history.replaceState` so closing the dialog does not re-open it.

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

## Phase 13: flow wiring

- Replenishment nets off open-draft quantity (`computeRequiredQty`), ending
  duplicate ordering from a recommendation that never cleared
- Batch endpoint groups selected recommendations into one draft per supplier,
  carrying cost price and supplier SKU
- Per-draft provenance surfaced as "Why this was ordered"
- Every cross-stage link carries its record id; Inventory tabs are URL-driven
- `invalidatePurchasingPipeline` refreshes the sibling stages after any mutation
  (query-string keys previously escaped endpoint-family invalidation)
