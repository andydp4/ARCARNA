# Phase F — Retail features

**Status (2026-06-04):** **F1–F7 Done** on `main` · F6 snags: [`GAPS_BACKLOG.md`](./GAPS_BACKLOG.md#gap-f6-01)

Six briefs: **F1** email receipts, **F2** shifts + Z-report, **F3** refunds polish, **F4** gift cards / store credit, **F5** loyalty UX, **F6** barcode scanner first-class. F1–F3 are reproduced here in the canonical Goal/Touch/Steps/DoD/Verification/PR-title format (originally in plan §16); F4–F6 expand the compact entries from the plan.

Execute strictly in numerical order — F2 depends on `orders.shift_id` (added by F2 itself), F3 reuses F2's `shift_id` in the refund timeline, F4 plugs into F3's payment-method system.

---

## Brief F1 — Email receipts

**Goal:** Send a branded HTML receipt by email after order completion, opt-in per customer, configurable per org.

**Touch:**

- `+ migrations/022_receipt_settings.sql` — `customers.receipt_email_opt_in boolean not null default true`; `organizations.receipt_template_html text`
- `~ shared/schema.ts` — both fields
- `+ server/workers/receiptEmailWorker.ts` — subscribes to `OrderCreated`, renders template, sends via Resend
- `+ server/templates/receipt.html.ts` — default template (org logo, lines, totals, tax breakdown, payment method, loyalty earned, footer + unsubscribe)
- `+ server/routes/receipts.ts` — `GET /api/receipts/settings`, `PUT /api/receipts/settings`, `GET /api/receipts/preview` (uses sample order), `GET /api/receipts/unsubscribe?token=` (signed URL → toggles `receipt_email_opt_in = false`)
- `+ client/src/pages/settings/receipts.tsx` — template editor + live preview
- `~ client/src/pages/pos.tsx` — "Email receipt" checkbox, auto-checked when customer has email + opt-in
- `~ package.json` — add `resend`
- `~ .env.production.example` — `RESEND_API_KEY`, `RECEIPT_FROM_EMAIL`, `RECEIPT_SIGNING_SECRET`

**Steps:**

1. Worker filters `OrderCreated` events where `total > 0`; fetches customer; sends only if `email` present and `receipt_email_opt_in = true`.
2. Template variables: `{{org.name}}`, `{{org.logoUrl}}`, `{{customer.name}}`, `{{order.number}}`, `{{order.total}}`, `{{order.lines}}` (each with `name/qty/price/lineTotal`), `{{order.paymentMethod}}`, `{{order.loyaltyEarned}}`, `{{unsubscribeUrl}}`.
3. Unsubscribe URL signed with `RECEIPT_SIGNING_SECRET` (HMAC over `customerId|email`). Endpoint verifies and flips the boolean.
4. Failures use existing worker retry; persistent failures land in DLQ with `event_type = 'OrderCreated'` and worker tag — visible on the worker-logs page.
5. Settings page: WYSIWYG-style textarea with live preview pane showing a sample order rendered by the same renderer.
6. Audit log: `receipt.sent { customerId, orderId, messageId }` per send via `recordAdminAudit`.

**Out of scope:**

- SMS receipts (separate brief).
- Print-only receipt template redesign.
- Multi-language receipts (set up in U-phase if i18n lands).

**DoD:**

- Live order placed to a real (test) email arrives within 60s with all line items + totals correct.
- Customer with `receipt_email_opt_in = false` receives no email.
- Unsubscribe link works (one click toggles opt-in off).
- Receipt preview matches sent email.
- Migration idempotent.

**Verification:**

- `curl -X POST /midnight/api/orders` (test order) → check inbox.
- `psql ... -c "select id, receipt_email_opt_in from customers where id=$id;"` after unsubscribe → `false`.
- DLQ count stays 0 over a 10-order smoke run.

**PR title:** `feat(receipts): email receipt worker + per-org template`

---

## Brief F2 — Shift open/close + Z-report

**Goal:** Cashier opens a shift with a float, closes with a cash count; system produces a Z-report (expected vs actual cash, variance, sales by payment method, top SKUs, printable).

**Touch:**

- `+ migrations/023_shifts.sql` — `shifts (id, org_id, location_id, user_id, opened_at, closed_at, opening_float numeric(10,2), closing_count numeric(10,2), expected_cash numeric(10,2), variance numeric(10,2), notes text, status varchar(16) check (status in ('open','closed','reopened')))`
- `+ migrations/024_orders_shift_id.sql` — `orders.shift_id uuid references shifts(id)`
- `~ shared/schema.ts` — `shifts` + `orders.shiftId`
- `+ server/routes/shifts.ts` — `POST /api/shifts/open`, `POST /api/shifts/:id/close`, `GET /api/shifts/:id/report`, `GET /api/shifts?status=`, `POST /api/shifts/:id/reopen` (MANAGER+)
- `+ shared/reports/zReport.ts` — pure function `shift + orders[] → ZReportData`
- `~ server/routes/orders.ts` (or routes.ts if M2 hasn't landed) — order creation auto-tags `shift_id` from `req.shift?.id` set by `requireOpenShift` middleware on POS routes
- `+ server/middleware/requireOpenShift.ts` — fetches the cashier's currently-open shift for the location; sets `req.shift`
- `+ client/src/pages/pos/shift-open.tsx` — modal at session start: location picker, opening float entry, confirm
- `+ client/src/pages/pos/shift-close.tsx` — wizard: cash count (denomination breakdown), notes, variance shown, confirm
- `+ client/src/pages/shifts.tsx` — manager view: today's shifts, variances, drill-down to Z-report
- `+ client/src/components/ZReport.tsx` — renders the report; printable

**Steps:**

1. Cashier opens shift: enter opening float in major denomination units. Server creates `shifts` row with `status='open'`. Client stores `currentShiftId` in `localStorage`.
2. `requireOpenShift` middleware runs on POS order routes; rejects with 409 if no open shift for the user+location.
3. Every order written during the shift has `order.shift_id` set.
4. Close shift wizard: enter counted cash (either denomination grid or total). Server computes `expected_cash = opening_float + cashSales − cashRefunds`, `variance = closing_count − expected_cash`. Status flips to `closed`, `closed_at = now()`.
5. Z-report shows: shift summary, order count, gross sales, refunds, net sales, sales by payment method, sales by category, top 10 SKUs, opening float + counted + expected + variance, cashier name, location, opened/closed timestamps.
6. Print version: A4 / receipt-printer friendly. Reuse invoice PDF generator with a `zReport.template.ts`.
7. Manager-only "reopen shift" requires a reason (free-text) and writes an `admin_audit_logs` entry.

**Out of scope:**

- Multi-drawer per shift.
- Live shift dashboard for managers (deferrable to U-phase or a small follow-up).
- Cash drop / mid-shift cash management (could be F2b).

**DoD:**

- Cashier opens shift, places 3 orders (1 cash, 1 card, 1 refund), closes with counted cash; Z-report's expected_cash matches a manually computed total.
- Variance displays correctly when counted ≠ expected.
- Reopen requires manager role; audit row appears.
- POS routes 409 when no open shift exists for the user+location.

**Verification:**

- `npm test -- zReport` (unit tests on the pure aggregator).
- Manual end-to-end: open → 3 sales → close; Z-report matches the manual sum.
- `select count(*) from orders where shift_id is null and created_at > now() - interval '1 day'` returns only pre-feature legacy rows.

**PR title:** `feat(ops): shifts + Z-report with variance`

---

## Brief F3 — Refunds & partial refunds UI polish

**Goal:** Cashier-friendly refund flow with reason codes, line-level partial refunds, correct inventory + cash drawer + loyalty handling.

**Touch:**

- `+ migrations/025_refunds.sql` — `refunds (id, order_id, org_id, cashier_id, shift_id, reason varchar(32), notes text, refund_method varchar(16) check (refund_method in ('original','cash','store_credit')), total numeric(10,2), created_at)`; `refund_lines (id, refund_id, order_line_id, qty int, amount numeric(10,2))`
- `~ shared/schema.ts` — both tables; `REFUND_REASONS` enum (`damaged | wrong_item | customer_changed_mind | defect | other`)
- `+ server/routes/refunds.ts` — `POST /api/orders/:id/refunds`, `GET /api/orders/:id/refunds`
- `~ server/eventBus.ts` — `RefundIssued` event payload includes `{ refundId, orderId, lines[], total, method }`
- `~ server/workers/inventoryWorker.ts` — handle `RefundIssued`: restore stock per line × qty (already partially wired; finish the handler and add a guard against double-handling)
- `~ server/workers/loyaltyWorker.ts` — handle `RefundIssued`: deduct points proportional to refunded value
- `+ client/src/pages/orders/refund.tsx` — wizard route `/midnight/orders/:id/refund`: line picker (qty per line) → reason → refund method → confirm
- `~ client/src/pages/orders.tsx` — refund entries inline in the order timeline; cumulative refunded total badge

**Steps:**

1. Validate: cannot refund more than `(line.qty − sum(refunded.qty))` per line; cannot refund a refund.
2. Refund method `original` only when the original payment method supports it (card via Stripe-like adapter — out of scope here, allow `original` for cash, fall through to `cash` otherwise).
3. Tag `refund.shift_id = current open shift.id` so F2's Z-report sees it as a cash-drawer adjustment.
4. On submit:
   - Write `refunds` + `refund_lines` rows in one transaction.
   - `publishEventTx(tx, 'RefundIssued', payload)` in the **same** transaction (S2 pattern).
5. Workers consume idempotently keyed on `(eventId, workerName)` via existing `processed_events` table.
6. Order page timeline shows: order created, refunds (with reason + total + cashier).
7. Audit log entry per refund.

**Out of scope:**

- Manager-PIN approval for refunds older than 90 days (follow-up).
- Multi-step approval workflow.
- External payment processor refunds (Stripe etc.) — keep `'original'` as a logical label until a payments brief lands.

**DoD:**

- Issue a partial refund on a 3-line order → stock returns only for refunded lines, loyalty points adjust proportionally.
- Cannot refund more than purchased qty.
- Refunds appear in F2's Z-report under cash refunds when method = `cash`.
- Migrations idempotent.

**Verification:**

- Vitest: `refunds.spec.ts` — over-refund rejected, double-handled event no-ops, points deduction proportional.
- Manual: 3-line order, refund 1 of line 2 → stock + 1 for that SKU only; points reduced by `(refundedAmount / orderTotal) × originalPoints` (rounded down).

**PR title:** `feat(refunds): line-level refund wizard with reasons + inventory + loyalty`

---

## Brief F4 — Gift cards / store credit

**Goal:** Issue, redeem (full or partial), and check balance on gift cards; also support "store credit" as a refund method (uses the same balance).

**Touch:**

- `+ migrations/026_gift_cards.sql` — `gift_cards (id uuid pk, org_id uuid, code varchar(32) unique not null, balance numeric(10,2) not null, original_amount numeric(10,2) not null, currency varchar(3) not null, issued_to_customer_id uuid null, issued_by_user_id uuid, status varchar(16) check (status in ('active','redeemed','expired','void')), expires_at timestamptz null, created_at timestamptz default now())`
- `+ migrations/027_gift_card_movements.sql` — `gift_card_movements (id, gift_card_id, order_id null, refund_id null, type varchar(16) check (type in ('issue','redeem','refund_credit','void','expire')), amount numeric(10,2), balance_after numeric(10,2), created_at)`
- `~ shared/schema.ts` — both tables + `GIFT_CARD_STATUS` enum
- `+ server/routes/giftCards.ts` — `POST /api/gift-cards` (issue), `GET /api/gift-cards/:code` (lookup by code), `POST /api/gift-cards/:code/redeem` (decrement), `POST /api/gift-cards/:code/void` (MANAGER+), `GET /api/gift-cards?customerId=` (list by customer)
- `~ server/eventBus.ts` — `GiftCardIssued`, `GiftCardRedeemed` events (idempotent worker handling)
- `~ server/routes/orders.ts` — payment method `gift_card`: validate code, redeem in same transaction as order create
- `~ server/routes/refunds.ts` (F3) — refund method `store_credit`: issues a new gift card to the customer for the refunded amount (`type = 'refund_credit'`)
- `+ client/src/pages/pos/payments/GiftCardPayment.tsx` — code entry, balance display, partial-apply with remaining due
- `+ client/src/pages/gift-cards.tsx` — manager view: search by code or customer, issue new, void, see movements
- `~ client/src/pages/customers.tsx` — customer detail shows active gift cards + total credit balance

**Steps:**

1. Code generator: 16-char base32 with check digit (Luhn over base32). Server stores raw code; show last 4 in lookups for privacy.
2. Issue flow: cashier selects "Issue gift card" → enters amount → optional `customerId` → confirm. Writes `gift_cards` row (`status='active'`) + `gift_card_movements` row (`type='issue'`). Emits `GiftCardIssued`.
3. Redeem at POS: cashier enters code → server returns balance; cashier enters apply amount (≤ balance, ≤ remaining order total); on order finalise, decrement balance + write movement (`type='redeem'`) in the **same transaction** as the order.
4. Void: MANAGER+ only; sets `status='void'` and `balance=0` with movement row. Audit log entry.
5. Expiry: optional `expires_at`; nightly worker flips `status='expired'` and zeroes balance with movement.
6. Refund as store-credit (from F3): issues a new gift card for the refund amount, scoped to the same customer, with `type='refund_credit'` movement.
7. Audit log on issue / void.

**Out of scope:**

- Physical card stock management (barcode label printing falls in F6).
- Bulk-import legacy gift cards from another system.
- Multi-currency gift cards (single org currency for now).

**DoD:**

- Issue → balance shows on customer page.
- Redeem £20 against a £15 purchase → balance £5, order paid in full.
- Redeem more than balance → rejected with clear error.
- Void → balance 0, cannot redeem.
- Refund as store credit → new card with refunded amount; customer sees both.
- All operations append exactly one `gift_card_movements` row.

**Verification:**

- Vitest: `giftCards.spec.ts` covering balance never going negative, idempotent redeem, void semantics.
- Manual: full issue → partial redeem → refund-as-credit → void cycle on one card / one customer.

**PR title:** `feat(payments): gift cards + store-credit refund method`

---

## Brief F5 — Loyalty UX (progress + redemption)

**Goal:** Make the existing loyalty tiers visible at the POS so customers know what they're earning, and let cashiers redeem points in the same step as taking payment.

**Touch:**

- `+ shared/loyalty/progress.ts` — pure function `computeTierProgress(customer, tiers) → { currentTier, nextTier, pointsToNext, percent }`
- `~ shared/schema.ts` — already has `loyalty_tiers`, `customers.loyalty_points`; add `loyalty_settings (org_id, redemption_rate numeric, min_redeem_points int)` if missing
- `+ migrations/028_loyalty_settings.sql` (only if the table doesn't exist)
- `~ server/routes/loyalty.ts` (or via M2's split) — `GET /api/loyalty/settings`, `PUT /api/loyalty/settings`, `POST /api/orders/:id/redeem-points` (decrement points → return discount)
- `~ client/src/components/CustomerPanel.tsx` — show tier badge + progress bar ("180 pts away from Gold")
- `~ client/src/pages/pos.tsx` — "Redeem points" button when customer has ≥ `min_redeem_points`; modal: enter points → preview discount → apply
- `+ client/src/pages/settings/loyalty.tsx` — manager: edit tiers, redemption rate, min redeem

**Steps:**

1. `progress.ts` is fully unit-tested and used by both server (badge in customer API response) and client.
2. POS customer panel renders the badge + percentage bar (`percent` from `progress.ts`).
3. Redemption: cashier clicks "Redeem points" → enters whole points → server validates min/max → decrements points → returns a "discount line" applied to the cart (server-side authoritative).
4. On order finalise, the discount line is persisted as `order_lines` with type `loyalty_discount` (existing pattern or add one).
5. Settings page lets manager edit tier thresholds + redemption rate (`100 pts = £1` default). Saved per org.

**Out of scope:**

- Birthday bonus rules (could be a small F5b).
- Tier expiry / annual reset.
- Customer-facing portal showing history (covered in long-horizon L1 / portal).

**DoD:**

- Customer with 280 pts shows "Silver, 220 pts to Gold (56%)" badge at POS.
- Redeem 100 pts → discount of £1 applied to cart, points balance reduced by 100.
- Below `min_redeem_points` → button disabled with tooltip.
- All loyalty math handled server-side; client only renders.

**Verification:**

- Vitest: `progress.spec.ts` — boundaries (just below tier, exactly at threshold, max tier).
- Manual: customer with 99 pts (min 100) → button disabled; 100 pts → enabled; redeem → balance 0; another redeem → button disabled.

**PR title:** `feat(loyalty): tier progress badge + redemption flow at POS`

---

## Brief F6 — Barcode scanner first-class

**Goal:** Plug-and-play USB / Bluetooth keyboard-wedge scanners on the POS page: scan → product added; audible beep on match; scanner input never leaks into search/quantity fields.

**Touch:**

- `+ client/src/hooks/useBarcodeScanner.ts` — listens at the window level for high-velocity keystrokes terminated by Enter; debounce 30ms; ignores when focus is in a text input / textarea / `contentEditable`
- `~ client/src/pages/pos.tsx` — uses the hook; calls `addProductByBarcode(code)` on scan; falls back to product search if no match
- `+ client/src/lib/posAudio.ts` — short success / fail beep generated via `AudioContext` (no asset file)
- `~ server/routes/products.ts` — `GET /api/products/by-barcode/:code` (returns product or 404; org-scoped)
- `~ shared/schema.ts` — verify `products.barcode varchar(64)` exists; if absent, add it + `+ migrations/029_products_barcode.sql`
- `~ client/src/pages/products.tsx` — barcode column + filter; bulk barcode print (deferred — note in PR)
- `~ docs/POS_USER_GUIDE.md` (create if absent) — scanner setup notes

**Steps:**

1. Hook detects scanner input by **inter-keystroke interval < 30ms** for a burst of ≥ 6 characters ending with `Enter`. Real typing has gaps > 30ms.
2. While focus is in an input/textarea/contentEditable, the hook short-circuits — preventing scanner input from polluting forms.
3. Hook exposes `onScan(handler)` for the POS page. Cleans up the global listener on unmount.
4. `addProductByBarcode(code)`:
   - Hits `/api/products/by-barcode/:code`.
   - Match → add 1 to cart (or +1 qty if already in cart) → success beep.
   - 404 → fail beep + toast "Unknown barcode <code>" → opens product search prefilled with the code.
5. Failure-tolerant: if AudioContext is blocked (Safari before first gesture), beeps silently no-op.
6. Setup doc covers keyboard-wedge configuration, suffix character, and how to test without a physical scanner using a 6+ char paste followed by Enter.

**Out of scope:**

- Image-based barcode scanning via webcam (separate brief; iOS+desktop friendly but more work).
- Label printing (note in PR; standalone brief later).
- Multi-scan cart import.

**DoD:**

- Scanner-emulated burst (6+ chars + Enter, < 30ms intervals) adds product to cart.
- Same burst while focus is in the search box does **not** add to cart — search receives the chars normally.
- Unknown barcode plays fail beep and opens search with code prefilled.
- `npm run check`, `npm run build`, `npm test` green.

**Verification:**

- Vitest with `@testing-library/user-event` simulating fast `keyboard` input.
- Manual: actual USB scanner connected → scan a known SKU → cart + beep; scan into search box → search receives normally.

**PR title:** `feat(pos): first-class barcode scanner with focus trap + beep`
