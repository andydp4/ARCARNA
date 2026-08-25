# Phase K — Cashier commission, credit and personal use

**Status (2026-08-25):** Briefed, not started · **`main` ref:** `3c6b597` (PR #139)
**Depends on:** F2 (shifts + Z-report), the cashier shift engine shipped alongside it.

Six briefs, in strict order: **K1** order attribution, **K2** per-order commission ledger,
**K3** credit (tick) lifecycle, **K4** credit and commission on the Z-report, **K5** personal
use as a payment type, **K6** negative-order guard and free-entry commission rates.

K2 depends on K1's two attribution columns. K3 depends on K2's ledger, because credit releases
commission on the day it is paid rather than the day it is sold. K4 reports what K3 records.
K5 and K6 are independent of each other but assume K1 is in.

---

## Why this phase exists

arcarna already pays cashier commission, but it pays it the wrong way round for how the business
actually works. Commission is worked out once per shift, credited to one person, on a profit
figure that includes a share of the shop's overheads. The business runs differently: one cashier
often loads an order and another completes it, the two split the money, and a sale on tick earns
nobody anything until the customer actually pays.

This phase moves commission from a shift-level total to a per-order ledger, gives credit its own
lifecycle so an unpaid sale cannot pay commission, and closes two gaps that let money leave the
building unrecorded — staff taking stock for themselves, and orders that total less than zero.

---

## Decisions locked

### Commission

| Rule | Value |
|------|-------|
| Profit on an order | Sale price, less cost of stock, less expenses on that order |
| Commission pool | Cashier's rate × profit. Default 10%; an admin sets any rate per cashier |
| Split of that pool | 90% to the cashier who **completed** the order, 10% to the cashier who **input** it |
| Different rates | The **completer's** rate governs the whole pool |
| Same person both ends | That person takes 100% of the pool |
| Web and storefront orders | The completer takes 100% — there is no inputter |
| Below-cost sale | Allowed. Negative margin, so the pool is zero. Never negative commission |

Worked example: an order with £100 of margin, taken by a cashier on the default rate, produces a
£10 pool — £9 to the completer, £1 to whoever loaded it.

### Credit (tick)

A sale on tick is two events on two different days.

**Completion day — the goods leave, the money does not:**

| Line | Effect |
|------|--------|
| Sales total | +£X — the sale happened, revenue is recognised |
| Cash | £0 |
| Credit given out today | +£X (new Z-report line) |
| Outstanding to recover | +£X; the order joins the credit list |
| Commission | £0 — nothing accrues |

**Payment day — the money arrives:**

| Line | Effect |
|------|--------|
| Cash | +£X (assumption A1 below) |
| Sales total | £0 — already counted on completion day (assumption A2 below) |
| Z-report | Shows "credit resolved from dd/mm/yy" |
| Outstanding to recover | −£X; cleared off the list |
| Commission | Accrues now — 90% completer, 10% inputter, on that order's profit |

### Refunds

Refunds are rare and handled by hand. The business takes the hit. There is **no automatic
clawback** of commission already paid. Where a refund was a cashier's fault it is a conversation,
not a system action.

### Negative orders and personal use

An order may never total less than zero — the till refuses it with a plain message. The one way
stock legitimately leaves without a sale is the new **personal use** payment type: it deducts the
stock, books the stock cost as an expense that day, records no sale and no commission, and
Signals every admin and manager that it happened.

### Assumptions recorded, not yet confirmed

Both are needed for the credit model to balance, and both were implied rather than stated:

- **A1** — on payment day, cash increases by the amount settled. Recovering the money is the point.
- **A2** — on payment day, the sales total does **not** increase again. It was counted on
  completion day; counting it twice would inflate sales by the value of every tick sale.

Build to these. If either is wrong, K3 changes.

---

## What the code does today, and where it conflicts

Every row below was read from the tree at `3c6b597`.

| # | Finding | Where |
|---|---------|-------|
| **F1** | **No inputter/completer distinction.** An order carries a single `cashier_id` and `cashier_shift_id`. The 90/10 split needs two cashiers per order | `shared/schema.ts:969` |
| **F2** | **Commission is per shift, not per order.** One `netSalesProfit` × one rate, persisted once per shift, credited to one cashier. A shift total cannot express a two-way split, nor commission accruing on a different day from the shift that sold it | `shared/reports/cashierShiftReport.ts:85`, `shared/schema.ts:916` |
| **F3** | **The commission base includes allocated overheads.** `netSalesProfit = paidSalesReceived − stockCost − orderExpenses − globalExpenseAllocation − refunds − discounts`. Overheads are allocated per calendar day in proportion to that day's sales, so they cannot be known for a single order at the moment of sale | `shared/reports/cashierShiftReport.ts:128`, `server/services/cashierShiftEngine.ts:247` |
| **F4** | **"Unpaid tick" is inferred from order status — the new model breaks it.** Unpaid credit is counted as tick orders whose `status !== "completed"`. Under the locked model a tick order **is** completed on completion day and simply unpaid, so every tick sale would read as paid immediately and pay commission on day one | `shared/reports/cashierShiftReport.ts:103` |
| **F5** | **Tick is settled per customer, in full, with no amount.** The only settle route clears a customer's entire debt. There is no per-order settlement, no partial amount, no record of when or how much | `server/routes/tickCustomers.ts:88` |
| **F6** | **The org default rate is a fixed dropdown** of 10/20/30. "12, 25, whatever is agreed" cannot be entered. The per-cashier rate is already a free input and the column already exists, so only the org control and the preset list need to change | `shared/schema.ts:36`, `client/src/components/settings/CashierCommissionSettings.tsx:204` |
| **F7** | **No `personal_use` payment method.** The till offers cash, card, transfer, tick, gift card. `payment_method` is a free `varchar(50)` with no check constraint, so adding one is additive | `client/src/pages/pos.tsx:964`, `shared/schema.ts:978` |
| **F8** | **Nothing blocks a negative order.** `insertOrderSchema` omits only id/timestamps/status; `total` has no lower bound in Zod and no check constraint in the database, and the orders route adds no guard | `shared/schema.ts:1025`, `server/routes/orders.ts` |
| **F9** | **There is no Signals table.** The machinery that exists is `event_outbox` + `job_queue` + `worker_run_logs`, plus `reportNotifications.ts`. The personal-use alert should ride the outbox, not a new bespoke path | `shared/schema.ts:1717`, `server/services/reportNotifications.ts` |
| **F10** | **The Z-report has no credit lines.** `ZReportData` carries gross, refunds, net, sales by payment method and category, top SKUs and the cash drawer. Nothing says how much credit was given out or resolved | `shared/reports/zReport.ts:41` |

---

## Open questions

**Blocking:**

1. **Do overheads sit in the commission base?** (F3) The locked wording is "after cost of stock and
   expenses are taken". If "expenses" means only the order's own costs — travel, delivery —
   commission is on the order's margin and K2 can accrue at completion. If it includes the daily
   overhead share, commission cannot be known until the day closes and must accrue a day in
   arrears. **Proposed default: order costs only.** Overheads stay in the business retained
   profit, where they already are. Blocks **K2**.
2. **Do partial payments release commission pro-rata?** (F5) Trade customers on account rarely clear
   an invoice in one hit. **Proposed default: pro-rata** — pay 40%, resolve 40% of the credit,
   accrue 40% of the commission, and the Z-report line reads as a partial resolution. Either way
   the credit record needs a running `amount_outstanding`, not a paid/unpaid flag. Blocks **K3**.

**Non-blocking, defaults proposed:**

3. **Write-off.** A tick that is never paid cannot sit on the list forever. Proposed: manager and
   admin only, comes off outstanding, records as a loss, accrues no commission.
4. **Return of an unpaid tick.** Goods come back before payment. Proposed: void — reverse the
   recognised sale, drop it off the list, nothing to claw back because nothing accrued.
5. **Personal use — notify only, or a hard stop?** The locked decision is notify-after. Proposed:
   notify only for this phase, plus a mandatory reason note, which is cheap and makes the Signal
   worth reading. A manager approval gate at the till is deferred.
6. **Below-cost markdown.** Blocking negatives must not block clearing dead stock. Proposed: block
   only a negative **total**; a below-cost sale is a positive total with a negative margin, and the
   pool already floors at zero.

**Out of this phase entirely:** shift windows, the 06:00 server cut and the Z-preview button were
settled in the same conversation but are not visible in the tree — `shiftInactivityCloseAfter`
offers 1 hour / 12 hours / 1 day / never and no daily cut. They need their own brief.

---

## Brief K1 — Order attribution: who input it, who completed it

**Goal:** Record separately the cashier who created an order and the cashier who completed it, so
a pool can be split between them.

**Touch:**

- `+ migrations/051_order_attribution.sql` — on `orders`: `input_cashier_id uuid references cashier_profiles(id)`, `completed_cashier_id uuid references cashier_profiles(id)`, `completed_cashier_shift_id uuid references cashier_shifts(id)`; backfill all three from the existing `cashier_id` / `cashier_shift_id`; index `(org_id, completed_cashier_id)`
- `~ shared/schema.ts` — the three columns on `orders`
- `~ server/routes/orders.ts` — set `input_cashier_id` from the open cashier shift at create; set `completed_cashier_id` and `completed_cashier_shift_id` at the transition to `completed`, in the same place the `settled_total` / `settled_at` snapshot is taken (migration 044)
- `~ server/services/cashierShiftEngine.ts` — `loadShiftOrders` keys on `completed_cashier_shift_id`
- `+ server/__tests__/orderAttribution.test.ts`

**Steps:**

1. Add the columns nullable. Backfill `input_cashier_id` and `completed_cashier_id` from
   `orders.cashier_id`, and `completed_cashier_shift_id` from `orders.cashier_shift_id`, so every
   historical order reads as one person doing both ends — which is what it was.
2. On create, stamp `input_cashier_id` from the cashier shift open on that device. Leave it null
   when there is none: a web or storefront order has no inputter, which is what makes the completer
   take 100% in K2.
3. On the first transition to `completed`, stamp `completed_cashier_id` and
   `completed_cashier_shift_id`. Treat them like `settled_total`: written once, never overwritten
   by a later status change.
4. Keep writing `cashier_id` as the completing cashier so existing reads keep working. Mark it
   deprecated in a comment; do not remove it in this brief.
5. Point `loadShiftOrders` at `completed_cashier_shift_id`. An order now belongs, for money
   purposes, to the shift that finished it — not the one that started it.

**Out of scope:**

- Any change to how commission is calculated — that is K2.
- Removing `orders.cashier_id`.
- Attributing refunds to a cashier.

**DoD:**

- An order created by cashier A and completed by cashier B carries both, distinctly.
- An order created and completed by the same cashier carries that cashier in both columns.
- A web-channel order has a null `input_cashier_id` and a set `completed_cashier_id`.
- Every pre-existing order has all three columns populated after backfill.
- `completed_cashier_id` does not change when a completed order is edited or its status moved on.
- Migration is idempotent.

**Verification:**

- `npm run check` and `npm run test`.
- `psql ... -c "select count(*) from orders where completed_cashier_id is null and status = 'completed';"` → 0 after backfill.
- Journey test: open a shift as A, load an order, close A's shift, open as B, complete it, assert both columns.

**PR title:** `feat(orders): record input and completing cashier separately`

---

## Brief K2 — Commission moves to a per-order ledger

**Goal:** Accrue commission per order, split 90/10 between completer and inputter at the
completer's rate, instead of one figure per shift.

**Touch:**

- `+ migrations/052_commission_ledger.sql` — `cashier_commission_entries (id, org_id, order_id, cashier_id, role varchar(16) check (role in ('completer','inputter')), basis varchar(24) check (basis in ('sale','credit_resolution')), order_margin numeric(12,2), commission_rate numeric(5,2), share_percent numeric(5,2), amount numeric(12,2), accrued_on date, accrued_at timestamp, cashier_shift_id uuid null references cashier_shifts(id), reversal_of uuid null references cashier_commission_entries(id))`; indexes on `(org_id, cashier_id, accrued_on)` and `(order_id)`
- `+ shared/reports/orderCommission.ts` — pure `buildOrderCommission(order, completerRate) → { margin, pool, entries[] }`
- `+ shared/reports/orderCommission.spec.ts`
- `+ server/services/commissionLedger.ts` — `accrueForOrder`, `reverseForOrder`
- `~ shared/reports/cashierShiftReport.ts` — the shift sheet sums the ledger for the shift instead of deriving commission itself; `commissionAmount` becomes a read, not a calculation
- `~ server/services/cashierShiftEngine.ts` — call the ledger at close
- `~ server/routes/cashiers.ts` — payroll and the paid/unpaid rollup read the ledger
- `~ server/routes/cashierAnalytics.ts` — commission columns read the ledger
- `+ server/__tests__/commissionLedger.test.ts`

**Steps:**

1. `buildOrderCommission` is pure and takes no database. Margin is `settledTotal` less the order's
   stock cost less the order's own expenses. Pool is `max(0, margin) × completerRate / 100`.
2. Split the pool: completer 90%, inputter 10%. When `input_cashier_id` is null, or equals
   `completed_cashier_id`, write one entry at 100% to the completer. Round each entry to the penny
   and give any rounding remainder to the completer, so the entries always sum to the pool exactly.
3. The rate is the **completer's** effective rate — the cashier's own rate, falling back to the org
   default. Reuse `effectiveCommissionRate`. The inputter's rate is never read.
4. Persist `commission_rate`, `share_percent` and `order_margin` on every entry. These are a
   snapshot: changing a cashier's rate later must never restate commission already accrued.
5. Accrue at completion for every payment method **except** tick. Tick accrues in K3 with
   `basis = 'credit_resolution'`, on the day the money arrives.
6. Personal use (K5) and any order with a zero or negative margin write no entries at all.
7. Rewrite `buildCashierShiftBalanceSheet` so `commissionAmount` is the sum of ledger entries whose
   `cashier_shift_id` is this shift, and `businessRetainedProfit` is `netSalesProfit` less that sum.
   Leave the rest of the sheet alone.
8. Bump `CALCULATION_VERSION` to 2. Do not restate closed shifts: existing summaries keep version 1
   and their stored figures.

**Out of scope:**

- Changing what `netSalesProfit` means for the shift sheet — the overheads question (F3) governs
  only the commission base, and this brief takes order costs only per the proposed default.
- Clawback on refund. Locked as manual; no reversal entries are written for refunds.
- Paying commission out. `cashier_commission_payments` is untouched.

**DoD:**

- £100 margin at 10%: completer entry £9.00, inputter entry £1.00, sum exactly £10.00.
- Same cashier both ends: one entry, £10.00.
- Web order: one entry to the completer, £10.00.
- Completer on 25% and inputter on 10%: pool is £25.00, split £22.50 / £2.50 — the inputter's rate
  is not read.
- Negative margin: no entries, and no negative commission anywhere.
- A tick order writes no entry at completion.
- Changing a cashier's rate does not alter any entry already written.
- Shift summaries closed before this ships are byte-identical after it.

**Verification:**

- `npm run test` — `orderCommission.spec.ts` covers the split, rounding and rate-precedence cases.
- `npm run check`.
- Seed a shift with mixed orders, close it, and assert the shift summary's `commissionAmount`
  equals `select sum(amount) from cashier_commission_entries where cashier_shift_id = $id`.

**PR title:** `feat(commission): accrue per order, split completer 90 / inputter 10`

---

## Brief K3 — Credit (tick): giving it, carrying it, resolving it

**Goal:** A tick sale recognises revenue without cash or commission on the day it completes, and
releases cash and commission on the day it is actually paid.

**Touch:**

- `+ migrations/053_credit_ledger.sql` — `order_credit (order_id uuid primary key references orders(id), org_id uuid not null, amount_given numeric(12,2) not null, amount_outstanding numeric(12,2) not null, status varchar(16) not null check (status in ('outstanding','partial','settled','written_off','voided')), given_on date not null, settled_on date)`; `credit_payments (id uuid primary key, org_id uuid not null, order_id uuid references orders(id), amount numeric(12,2) not null check (amount > 0), paid_on date not null, method varchar(50), recorded_by_user_id uuid, note text, created_at timestamp)`; backfill `order_credit` from existing tick orders
- `~ shared/schema.ts` — both tables
- `+ server/routes/credit.ts` — `GET /api/credit/outstanding`, `POST /api/credit/:orderId/payments`, `POST /api/credit/:orderId/write-off` (MANAGER and above), `POST /api/credit/:orderId/void`
- `~ server/routes/tickCustomers.ts` — `mark-paid` becomes a convenience that posts one full payment per outstanding order for that customer, so the existing button keeps working
- `~ server/services/commissionLedger.ts` — accrue on resolution, pro-rata to the amount paid
- `~ shared/reports/cashierShiftReport.ts` — replace the `status !== 'completed'` test (F4) with a read of `order_credit.amount_outstanding`
- `~ client/src/pages/tick-list.tsx` — per-order rows with amount outstanding, and a part-payment control
- `+ server/__tests__/credit.test.ts`

**Steps:**

1. On completing an order paid by tick, write `order_credit` with `amount_given` and
   `amount_outstanding` both set to the settled total, `status = 'outstanding'`, `given_on` today.
   Recognise the sale as normal. Take no cash. Write no commission entry.
2. Fix F4 first, before anything else in this brief: unpaid credit is `amount_outstanding > 0` on
   `order_credit`, never `status !== 'completed'` on the order. Without this, every tick sale reads
   as paid the moment it completes.
3. A payment inserts a `credit_payments` row and reduces `amount_outstanding`. Status becomes
   `partial` while some remains and `settled` at zero, stamping `settled_on`.
4. Each payment accrues commission pro-rata: the share of the order's pool equal to the share of
   `amount_given` just paid, split 90/10 as in K2, `basis = 'credit_resolution'`, `accrued_on` the
   payment date. A fully settled order must have accrued exactly its whole pool — reconcile the
   final payment against the sum already accrued so rounding cannot leave a penny behind or over.
5. Write-off sets `amount_outstanding` to zero and `status = 'written_off'`, records the remainder
   as a loss, and accrues no commission. Manager and admin only.
6. Void reverses the recognised sale, sets `status = 'voided'`, drops the order off the list, and
   claws back nothing — nothing accrued.
7. Overpayment is refused. A payment may not exceed `amount_outstanding`.

**Out of scope:**

- Customer statements, ageing buckets, or chasing letters.
- Interest or late fees.
- Credit limits per customer, and any block on selling more tick to a customer already over.

**DoD:**

- A tick sale on day 1: sales up, cash unchanged, outstanding up, zero commission entries.
- Paid in full on day 3: cash up, sales unchanged, outstanding zero, commission entries dated day 3
  summing to the order's whole pool, split 90/10.
- Paid 40% then 60%: two accruals, together exactly the whole pool, neither a penny out.
- Written off: outstanding zero, recorded as a loss, no commission.
- Voided before payment: off the list, sale reversed, no commission, nothing clawed back.
- A payment larger than what is outstanding is refused with a plain message.
- The existing per-customer "mark paid" button still clears that customer and now accrues correctly.

**Verification:**

- `npm run test` — partial-payment rounding is the case to watch: assert
  `sum(entries) = pool` to the penny across a 3-way split of an awkward total such as £33.33.
- `npm run check`.
- Manual: sell on tick, check the Control Centre shows it outstanding and unpaid, settle it, check
  commission appears dated today and not the sale date.

**PR title:** `feat(credit): tick lifecycle with commission released on payment`

---

## Brief K4 — Credit and commission on the Z-report

**Goal:** A shift's Evidence shows credit given out today and credit resolved from earlier days, so
the takings reconcile against the drawer.

**Touch:**

- `~ shared/reports/zReport.ts` — add `creditGivenOut: number` and `creditResolved: Array<{ givenOn: string; amount: number }>` to `ZReportData`
- `~ shared/reports/zReport.spec.ts`
- `~ server/routes/shifts.ts` — feed both from `order_credit` and `credit_payments`
- `~ client/src/pages/shifts.tsx` — two rows in the Z-report dialog
- `~ client/src/pages/pos/cashier-shift.tsx` — the shift-closed summary gains the same two lines
- `~ docs/training/sections/02-opening-shifts.html` — the Z-report "what it shows" table gains both rows

**Steps:**

1. `creditGivenOut` is the sum of `amount_given` for credit records created during this shift.
2. `creditResolved` groups `credit_payments` taken during this shift by the `given_on` date of the
   order they settle, so the line reads "credit resolved from 12/08/26 — £240.00". A shift settling
   credit from three different days shows three lines.
3. Neither figure touches `netSales`. Credit given out was already counted as a sale on its own day;
   credit resolved is cash arriving against a sale already counted. This is assumption A2, and the
   test for it belongs here.
4. `creditGivenOut` explains a drawer that is light: the sales are real, the cash is not there yet.
   Put it directly beneath the cash drawer block, where the question gets asked.
5. Update the training manual's table in the same PR. It is the only place a cashier will read what
   these lines mean.

**Out of scope:**

- Reprinting or restating Z-reports produced before this ships.
- A credit ageing report — that is its own brief if it is wanted.

**DoD:**

- A shift that gives £300 of tick and settles £120 from last week shows both, separately.
- Neither line changes `netSales`.
- A shift with no credit activity shows neither line, rather than two zeroes.
- The printed Z-report carries both.
- The training manual describes both.

**Verification:**

- `npm run test` — `zReport.spec.ts`.
- Manual: sell on tick, close the shift, read the Z-report; settle it next day on a different
  shift, read that Z-report.

**PR title:** `feat(evidence): credit given and resolved on the Z-report`

---

## Brief K5 — Personal use as a payment type

**Goal:** Staff taking stock for themselves is recorded as stock out and a cost that day, never as
a sale, and always tells a manager.

**Touch:**

- `+ migrations/054_personal_use.sql` — `orders.personal_use_reason text`
- `~ shared/schema.ts` — the column
- `~ client/src/pages/pos.tsx` — a `personal_use` option, labelled "Personal use (staff)", with a required reason field
- `~ server/routes/orders.ts` — personal-use handling: total forced to zero, reason required, stock deducted, an `order_expenses` row for the stock cost dated today, no commission
- `~ shared/reports/cashierShiftReport.ts` and `~ shared/reports/zReport.ts` — its own line, excluded from sales and from every payment-method total
- `+ server/workers/personalUseSignalWorker.ts` — consumes `PersonalUseRecorded` from `event_outbox`, Signals every admin and manager in the org
- `~ server/eventBus.ts` — emit `PersonalUseRecorded`
- `+ server/__tests__/personalUse.test.ts`

**Steps:**

1. Personal use is a payment method, not an order type — `payment_method` is a free varchar with no
   check constraint, so nothing structural changes.
2. Force the order total to zero server-side. Do not trust the client for this.
3. Deduct stock through the existing `inventory_movements` path, exactly as a sale does. The stock
   has left the building either way.
4. Write the stock cost as an `order_expenses` row against the order, dated the day it happened.
   That is what makes it land as a cost rather than vanishing.
5. Write no commission entries, and exclude it from `grossSales`, `paidSalesReceived` and every
   payment-method breakdown. It is not a sale and must never read as one.
6. The reason note is mandatory. A Signal that says only "personal use, £14.20" gets ignored; one
   that says "staff lunch — 2 × sandwich" gets read.
7. Emit `PersonalUseRecorded` to the outbox in the same transaction as the order. The worker fans
   out to admins and managers. Failures retry through the existing worker path and land in the DLQ
   like any other event — the Signal must not be able to silently not happen.

**Out of scope:**

- A manager approval gate at the till. Locked as notify-after; revisit if it is abused.
- A spend limit or a monthly personal-use allowance per cashier.
- Any change to how ordinary expenses are recorded.

**DoD:**

- A personal-use order records zero sales, deducts the stock, and books the stock cost as an expense
  dated that day.
- It writes no commission entries for anyone.
- It appears on its own Z-report line and in no payment-method total.
- Every admin and manager in the org receives a Signal naming the cashier, the items, the cost and
  the reason.
- The order cannot be saved without a reason.
- The Signal still arrives when the worker's first attempt fails.

**Verification:**

- `npm run test`.
- Manual: record a personal-use order, confirm stock fell, the day's expenses rose by the stock
  cost, sales did not move, and the Signal arrived for a second manager account.
- `psql ... -c "select count(*) from cashier_commission_entries e join orders o on o.id = e.order_id where o.payment_method = 'personal_use';"` → 0.

**PR title:** `feat(pos): personal use payment type with manager Signal`

---

## Brief K6 — Negative orders blocked, and free-entry commission rates

**Goal:** An order can never total less than zero, and an admin can set any commission rate rather
than picking one of three.

**Touch:**

- `+ migrations/055_order_total_non_negative.sql` — `alter table orders add constraint orders_total_non_negative check (total >= 0)`, after a check for existing violations
- `~ shared/schema.ts` — `insertOrderSchema` extends `total: z.coerce.number().min(0, "An order cannot total less than zero")`; `COMMISSION_RATE_PRESETS` keeps its three values but is renamed in intent to quick-pick suggestions, not the permitted set
- `~ server/routes/orders.ts` — reject a negative total with 400 and a plain message
- `~ client/src/components/settings/CashierCommissionSettings.tsx` — the org default rate becomes a number input accepting 0–100 with up to two decimals, with 10/20/30 offered as quick-pick chips beside it
- `~ server/routes/settingsOrg.ts` — validate the org rate as a number in 0–100 rather than a member of the preset list
- `+ server/__tests__/orderTotalGuard.test.ts`

**Steps:**

1. Check production for existing negative totals before adding the constraint. If any exist, the
   migration fails loudly rather than quietly dropping the guard — fix the rows, then apply.
2. Guard in three places, because each catches a different mistake: Zod at the boundary, a check
   constraint in the database, and a plain message at the till.
3. The message a cashier sees says what to do, not what went wrong: an order cannot total less than
   zero, and a refund is the way to give money back.
4. A below-cost sale is untouched by this. Its total is positive; only its margin is negative, and
   the pool already floors at zero, so clearing dead stock keeps working.
5. Personal use (K5) sets the total to zero, which satisfies `>= 0`. Sequence K5 before this or
   confirm the constraint admits zero.
6. Free-entry rates: the per-cashier field is already a free input and the column already exists.
   Only the org-level control and its validation are restricting things.

**Out of scope:**

- Refund flow changes. Refunds are already a separate path and stay that way.
- Per-location or per-product commission rates.

**DoD:**

- An order with a negative total is refused at the API with 400 and never reaches the database.
- The database refuses one too, if inserted directly.
- The till shows a plain message and keeps the basket intact rather than clearing it.
- A below-cost sale with a positive total still completes and pays zero commission.
- An admin can set an org default of 12.5% and a per-cashier rate of 25%.
- A rate outside 0–100 is refused.

**Verification:**

- `npm run test` and `npm run check`.
- `psql ... -c "insert into orders (org_id, total, payment_method) values ('$org', -5, 'cash');"` → rejected by the constraint.
- Manual: set the org default to 12.5, close a shift, confirm the pool used 12.5%.

**PR title:** `fix(orders): block negative totals and allow any commission rate`

---

## Sequencing and size

| Brief | Depends on | Rough diff |
|-------|-----------|-----------|
| K1 | — | small |
| K2 | K1 | large — the ledger and the shift-sheet rewrite |
| K3 | K2 | large — two tables, new routes, the F4 fix |
| K4 | K3 | small |
| K5 | K1 | medium |
| K6 | K5 | small |

K2 and K3 will each exceed the 600-line target in `README.md`. Split them if a reviewer asks, but
do not split K3's F4 fix away from the credit tables — a half-landed credit model pays commission
on money nobody has received.

Answer the two blocking questions before starting K2.
