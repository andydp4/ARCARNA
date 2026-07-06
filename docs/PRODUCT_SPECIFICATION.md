# arcarna — Product Specification & Features

**Document type:** Product specification and full features list
**Product:** arcarna (business-intelligence platform delivered as an EPOS)
**Promise:** Reveal Your Truth™
**Status:** Living document — reflects the system as built. Formulas and methodology are stated verbatim from the implementation for transparency.

> A note on the name: the product is written **arcarna**, lowercase, everywhere. This document follows that rule except where a proper noun (a page title in a screenshot, a third-party product) requires otherwise.

---

## 1. What arcarna is

arcarna is an electronic point-of-sale (EPOS) system for independent retail and hospitality businesses — but its purpose is larger than taking payments. Every sale, refund, stock movement, supplier delivery, expense, shift and loyalty redemption feeds a single, living understanding of the business. Where a traditional till **records** what happened, arcarna is built to **explain** it: what happened, why it happened, and what to do next.

The system is multi-tenant SaaS. A single deployment serves many independent businesses ("organisations"), each with its own users, locations, products, customers, pricing, branding and data. Data is strictly isolated per organisation — no query returns another organisation's records.

The product runs as a Progressive Web App (PWA): it installs to a till, tablet or phone, works offline through a service worker, and syncs automatically when the connection returns. A shop never stops trading because the internet did.

### 1.1 Design principles (governing every feature)

- **Truth over opinion.** Every figure carries its evidence and its comparison window.
- **Explain, don't just display.** A chart that doesn't lead to a decision has no place in the product.
- **Calm and honest.** No hype, no dark patterns, no manufactured urgency.
- **Built for the worst hour.** Saturday rush, one hand, direct sunlight, broadband down — if it works then, it works.

---

## 2. System architecture (summary)

| Layer | Technology | Notes |
|-------|-----------|-------|
| Client | React 18 + TypeScript, Vite, Wouter (routing), TanStack Query, Tailwind + Radix UI | PWA with offline storage (IndexedDB) and a background sync service |
| Server | Node.js + Express 5 (TypeScript), bundled with esbuild | Single process; event-driven workers run in-process |
| Data | PostgreSQL (Neon or self-hosted), Drizzle ORM | `shared/schema.ts` is the single source of truth for the schema |
| Auth | Clerk (primary), with a legacy provider path retained for rollback | MFA enforced for super-admin on sensitive routes |
| PDF | PDFKit (server-side) | Invoices generated on demand, no external storage |
| Email | Resend | Branded receipts and invoice delivery |
| Messaging | WhatsApp Business API | Inbound webhook (HMAC-verified), order intents, conversations |

**Tenancy model.** Every tenant-scoped table carries an `org_id`. Requests resolve an org context from the authenticated user (and an `X-Org-Id` header for super-admins operating across orgs). Middleware (`requireOrgContext` → `requireOrgScope` → `requireRole`) gates every scoped route, and fails closed if the context is missing.

**Event-driven core.** Placing an order writes the order transactionally and emits an `OrderCreated` domain event to an outbox. In-process workers consume events idempotently (a `processed_events` table guarantees exactly-once effects): the inventory worker adjusts stock, the invoice worker creates the invoice record, the loyalty worker awards points, the analytics/finance workers update the understanding, and the receipt worker emails a receipt if requested. This keeps the checkout fast and makes each side-effect independently retryable.

---

## 3. Feature catalogue

Each feature below is described in full, including — where the system computes a number — the exact method it uses.

### 3.1 Control Centre (the home screen)

The Control Centre answers one question: *how is the business doing right now?* It refreshes every 60 seconds and presents:

- **Today's numbers** — revenue taken today, transaction count, and average order value (AOV), each compared against the same day last week and against the 12-month average for the same weekday. Comparing like-for-like weekdays prevents a quiet Tuesday from being unfairly judged against a busy Saturday.
- **Business Health** — revenue today, revenue over the trailing 7 days, orders today, and new customers over the last 7 days, plus a worker-health badge that confirms background processing is running.
- **Risk highlights** — issues that warrant attention, most notably dead stock (see §3.8 Stock turn).
- **Quick actions** — shortcuts to the most common jobs.

**AOV formula.** `AOV = revenue ÷ number of transactions` over the chosen window. Where transactions are zero, AOV is reported as £0.00 rather than dividing by zero.

### 3.2 Orders & the till (Create Order)

The till builds a basket and takes payment. The flow is: **add items → review the cart → choose payment & confirm.**

- **Products** are added from a searchable grid; quantities adjust in the cart. Stock badges show availability.
- **Customer** can be a walk-in (anonymous) or a named customer. Attaching a named customer enables loyalty earning/redemption and links the sale to that customer's history.
- **Discounts** — a promotion code (available once a customer is attached), an automatic loyalty-tier discount, and points redemption.
- **Payment methods:** Cash, Card, Bank transfer, On credit ("tick"), and Gift card. A sale may combine a gift card with a remainder method.
- **Order expenses** — costs specific to a single order (e.g. a courier) can be attached, so the true profit of that order can be measured.
- **Receipt** — an emailed receipt can be sent to the customer; invoices are generated separately and on demand.

**What a completed sale records:** the order header (org, location, customer, cashier, shift, total, payment method, channel, status) and its line items (product, quantity, unit price, line total). Placing the order emits the `OrderCreated` event that drives all downstream effects (§2).

**Order totals & tax (VAT) methodology.** arcarna treats order totals as **tax-inclusive**. Given an order `total` and the organisation's `defaultTaxRate` (a percentage, default 20%), the split is:

```
taxRate  = defaultTaxRate / 100          e.g. 20  → 0.20
subtotal = total / (1 + taxRate)          e.g. £12.00 / 1.20 = £10.00
tax      = total − subtotal               e.g. £12.00 − £10.00 = £2.00
```

This is applied consistently by the invoice worker and the invoice PDF generator. If an order's event payload already carries a tax breakdown it is used directly; otherwise the split above is computed from the org's tax rate.

### 3.3 Monitoring & updating orders (Open Orders)

Orders already created are listed with status counts, a status filter and search. Statuses include pending, on hold, awaiting customer, urgent and completed. Opening an order shows its detail: customer, status, total and line items.

**Authorisation:** viewing is available to any org member. Changing an order's **status** is available to cashiers and managers (`PATCH`), because a cashier legitimately advances an order through its lifecycle. **Editing** an order (`PUT`) and **deleting** an order (`DELETE`) require a manager role or above — deletion cascades through refunds, invoices, loyalty ledger and gift-card movements, so it is deliberately restricted.

### 3.4 Refunds

A refund is raised against an existing order. The cashier selects lines and quantities to refund (bounded by what was actually sold and not already refunded), gives a reason (damaged, wrong item, changed mind, defect, other) and a method (original, cash, store credit). The refund is recorded with its lines, stock is settled appropriately, and any linked gift-card/loyalty effects are reconciled. Refund totals feed the shift balance sheet and the profit Truths.

### 3.5 Invoices

Invoices are generated **on demand** as PDFs by a server-side generator (PDFKit) — there is no dependency on external file storage. Each invoice PDF is branded per organisation: the org's trading name, address, company/VAT number, email, logo (if enabled) and bank/payment details are drawn from that org's settings. Sections with no configured data are omitted rather than shown blank.

An invoice can be viewed, downloaded, printed, or emailed. Invoice numbering uses the org's configured prefix and start number. The invoice screen summarises paid, pending and overdue totals.

**Invoice subtotal/VAT** follow the same tax-inclusive split as §3.2. VAT is computed from real order data and the org's tax rate — never a hardcoded assumption.

### 3.6 Products & inventory

Products carry a name, a unique product code (SKU), a cost price, a default sale price, current stock, a reorder level (stock limit), an optional barcode and optional aliases. Products can be added individually or imported in bulk from a spreadsheet with a column-mapping preview.

- **Margin** at any point is `sale price − cost price`; keeping cost prices accurate is what makes the profit Truths trustworthy.
- **Stock** decreases automatically as items sell (inventory worker on `OrderCreated`) and increases when a goods receipt is completed against incoming stock/purchase drafts. Manual stock edits are for counts and corrections.
- **Retiring** a product removes it from the till while preserving its history in past orders and the analytics built from them.

Inventory supports incoming stock, purchase drafts (an internal reorder workflow that does not itself change stock) and goods receiving (which does increase stock, per location, on completion).

### 3.7 Customers & tick accounts

Customers carry name, phone, email, a receipt-email opt-in (default on), address, a category/tier, loyalty points and total spent. Customer history (orders, spend, loyalty) attaches to the record and powers the customer Truths (§3.8).

The **Tick List** tracks customers buying on account (credit): what each owes, with actions to record a payment or send a reminder.

### 3.8 Truths (understanding — insights & analytics)

The Truths area turns recorded activity into findings, each carrying its evidence. The measures and their exact methods:

#### 3.8.1 Customer groups — RFM

RFM scores each customer on three axes and assigns them to a segment.

- **Recency (R)** — days since last purchase.
- **Frequency (F)** — number of orders.
- **Monetary (M)** — total spent.

Each axis is converted to a **1–5 score by quintile ranking against the org's other customers** (higher is better; for recency, more recent is better). From the three scores and the order count, the segment is assigned by this map:

```
orderCount == 1 and R == 5                      → New
R == 5 and F ≥ 4 and M ≥ 4                       → Champions
F ≥ 4 and M ≥ 3 and R ≥ 3                        → Loyal
R ≥ 4 and F ≤ 2                                  → Promising
R ≤ 2 and F ≥ 3 and M ≥ 3                        → At-Risk
R ≤ 2 and F ≤ 2                                  → Lost
R ≥ 3 and F ≥ 3                                  → Loyal
R ≥ 3                                            → Promising
otherwise                                        → At-Risk
```

Splitting recency from spend is deliberate: a big past spender who has stopped visiting is *At-Risk*, not a *Champion* — so the business wins them back rather than assuming they're fine.

#### 3.8.2 Busiest hours — hour of day

Orders are aggregated into a **7 × 24 grid** (day of week × hour of day) and each cell shows **average revenue** for that day-and-hour slot. Averaging by slot (rather than summing across the week) means each peak is judged against its own kind — Saturday afternoons against Saturday afternoons. Used for staffing, delivery cut-offs, and timing promotions (or noticing where a discount is quietly costing you at your busiest hour).

#### 3.8.3 Order channels — channel attribution

Takings are attributed across the channels an order arrived through (e.g. POS, WhatsApp), so the business can see which routes actually bring money in and whether the effort put into a channel pays back.

#### 3.8.4 Stock turn

For each product category (category is derived from the SKU prefix before the first hyphen/underscore, defaulting to "General"), stock turn is computed over a window:

```
dailySalesRate = unitsSold ÷ windowDays          (windowDays floored to ≥ 1)
turnRate       = unitsSold ÷ avgStock             (rounded to 2 dp; if avgStock = 0, turnRate = unitsSold)
daysOfStock    = avgStock ÷ dailySalesRate        (rounded to 1 dp; = 999 if there are no sales but stock on hand)
```

Each category is then classified:

```
daysOfStock ≤ 0 or non-finite   → healthy   (nothing tying up money)
daysOfStock  > 90               → slow      (dead/dying stock)
30 ≤ daysOfStock ≤ 90           → watch
daysOfStock < 30                → healthy
```

"Slow" categories are the dead stock surfaced on the Control Centre's Risk highlights. Stock turn answers the costly question: *is my money sitting on shelves, or working?*

### 3.9 Cashier commission & shifts

A shift represents a till session (opening float → activity → closing count → variance), and where cashier commission is enabled, each shift is attributed to a cashier and produces a **balance sheet**. The commission methodology is stated in full because transparency about people's pay matters.

**Effective commission rate.** A cashier's own configured rate is used if set; otherwise the organisation's default cashier commission rate applies.

**Shift balance sheet.** For the orders in a shift:

```
grossSales          = Σ order totals (only positive totals counted)
unpaidCreditSales   = Σ totals of tick (on-credit) orders not yet completed
paidSalesReceived   = grossSales − unpaidCreditSales
stockCost           = Σ (line quantity × line cost price)   [flags incomplete if any cost price is missing]
refundsTotal        = Σ refund totals (positive)
netSalesProfit      = paidSalesReceived − stockCost − orderExpenses − globalExpenseAllocation − refundsTotal − discounts
commissionAmount    = max(0, netSalesProfit) × (commissionRate ÷ 100)
businessRetainedProfit = netSalesProfit − commissionAmount
```

**Global expense allocation.** Daily business-wide expenses (those not tied to a single order) are shared across shifts in proportion to each shift's paid sales versus the organisation's total paid sales that day. This means a cashier's commission is calculated on profit *after* a fair share of the day's running costs — not on revenue, and not on profit that ignores overheads.

All money values are rounded to whole pence (`roundMoney`). Commission is never negative (the `max(0, …)` guard): a loss-making shift produces zero commission, not a clawback. Where any line lacks a cost price, the sheet flags the cost data as incomplete so the figure is treated with appropriate caution rather than presented as exact.

Shifts auto-close after a configured period of inactivity, producing a summary snapshot. Commission payments are confirmed by a manager (MFA-gated), written to an append-only audit log, and can trigger notifications. Payroll reporting aggregates confirmed commission per cashier over a period.

### 3.10 Loyalty

Customers earn points on sales attributed to a named customer and redeem them at checkout as a discount. Points and redemptions are recorded in a loyalty ledger; the customer's balance is the running total. Tiers (bands such as Bronze/Silver/Gold) recognise regulars and can carry benefits. Earning rate, redemption value and tier thresholds are configured per organisation in settings. Because earning requires a named customer, using named customers at the till is what makes both loyalty and the customer Truths work.

### 3.11 Expenses

Expenses are the running costs of the business. Overhead expenses (category, amount, date, notes) are logged generally; order expenses attach a cost to a specific order. Expenses flow into the profit signal on the Control Centre, the shift balance sheet's global allocation (§3.9), and the expense reports (summaries by category and period). Logging costs as they happen is what keeps the profit numbers honest — revenue up does not mean profit up.

### 3.12 Multi-location

An organisation may run multiple locations. Stock, shifts, orders and reporting can be scoped per location. A user has a default location and can be permitted specific locations.

### 3.13 Setup wizard & settings

A first-run setup wizard captures the business profile (trading name, address, VAT/company number, currency, timezone), branding (logo, accent, receipt/invoice logo toggles, invoice payment/bank details), invoicing (prefix, start number, payment terms, default tax rate) and cashier commission configuration. Everything is editable afterwards in Settings, which also covers users & access, cashiers & commission, loyalty, receipts and integrations.

### 3.14 Integrations

- **WhatsApp Business** — an HMAC-verified inbound webhook ingests messages and status updates; conversations are tracked and order intents can be created. Verification is mandatory when the integration is enabled.
- **Email (Resend)** — branded receipts and invoice delivery.
- **Authentication (Clerk)** — hosted sign-in, with MFA enforced for super-admin on sensitive routes.

---

## 4. Access control & roles

| Role | Capabilities |
|------|-------------|
| CASHIER | Own shift start/end, create orders, take payments, advance order status, customer lookup, redeem loyalty |
| MANAGER | All cashier abilities, plus products/stock, customers, order edit/refund/delete, expenses, Truths, invoices, end-of-day |
| ADMIN | All manager abilities, plus user approval, settings, branding, locations, org configuration |
| SUPER_ADMIN | Cross-org operation; sensitive actions gated behind MFA |

New users must be approved by an admin before they see any data; a pending user receives no organisation scope. Destructive and sensitive actions (user approval, commission confirmation, allowed-user changes) require super-admin MFA. Every access-control and org-creation action is written to an append-only `admin_audit_logs` table.

---

## 5. Data model (principal tables)

`organizations`, `users`, `locations`, `products`, `customers`, `orders`, `order_items`, `refunds`, `refund_lines`, `invoices`, `overhead_expenses`, `order_expenses`, `shifts`, `cashier_profiles`, `cashier_shifts`, `cashier_shift_summaries`, `cashier_commission_payments`, `loyalty_tiers`, `loyalty_ledger`, `gift_cards`, `gift_card_movements`, `inventory_movements`, `processed_events`, `admin_audit_logs`, plus WhatsApp conversation/intent/template tables. Every tenant table carries `org_id`; hot lookups are indexed (org_id on orders/customers/invoices/order_items, order_id on order_items/invoices, and so on).

---

## 6. Transparency statement

Every formula in §3 is stated as the system actually computes it, taken from the implementation. arcarna's principle is *evidence before opinion*: a number shown to a business owner should be one they can trace. Where a figure depends on data that may be incomplete (e.g. a missing cost price in the commission sheet), the system flags the incompleteness rather than presenting an exact-looking result. Percentages are always reported with their comparison window; currency is rounded to whole pence.

---

*This specification describes arcarna as built. It is maintained alongside the code; where a figure or behaviour changes in the product, this document is updated to match.*
