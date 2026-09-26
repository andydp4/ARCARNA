# RBAC (Role-Based Access Control)

## Who sees what (owner decisions, v1.2 Phase 0B)

"You" is the platform owner (SUPER_ADMIN). Every row is enforced on the
server by the end of Phase 0B; a hidden menu entry is never the lock. Rows
that are not closed yet show up in the role-matrix test's `KNOWN_LEAKS`.

| | Cashier | Manager | Admin | You |
|---|---|---|---|---|
| Sell, orders, own shift | Yes | Yes | Yes | Yes |
| Products: create, edit, delete, aliases, import | No | Yes | Yes | Yes |
| Cost prices and margins | Never, not even in API data | Yes | Yes | Yes |
| Minimum prices: set, change, clear; price history (v1.2 Phase 2) | No | Yes | Yes | Yes |
| "Would have flagged": underpriced sales recorded silently, by product and person (v1.2 Phase 2) | No | No | Yes | Yes |
| "Price guard at the till" switch (off by default; every change logged) (v1.2 Phase 4) | No | No | Yes | Yes |
| Till price warning: one amber line with the lowest price, never a cost; reason at Pay (v1.2 Phase 4) | Yes | Yes | Yes | Yes |
| Price guard Signals: below minimum and below cost; a manager's own go to admins and the owner only (v1.2 Phase 4) | No | Yes | Yes | Yes |
| Answer "Manager agreed": only the manager named (v1.2 Phase 4) | No | Named | Named | Named |
| Card (link): make, cancel or send a Stripe payment link for a sale, or take another tender instead; the customer's number never reaches the till (v1.2 Stripe links) | Yes | Yes | Yes | Yes |
| Stripe settings: connected or not set up, webhook URL, the .env lines (never a key) (v1.2 Stripe links) | No | Yes | Yes | Yes |
| Card (link) Signals: paid for the wrong amount, or paid after another tender (v1.2 Stripe links) | No | Yes | Yes | Yes |
| Needs a look: review exceptions (open, acknowledged, explained, escalated) (v1.2 Phase 4) | No | About cashiers | About cashiers and managers | All |
| Price overrides Evidence: by cashier, product and reason (v1.2 Phase 4) | Own count on their shift only | About cashiers | About cashiers and managers | All |
| Rules: below-minimum Signals now or twice daily; refund thresholds (v1.2 Phase 4) | No | Read | Change, logged | Change, logged |
| Bulk "Set minimum price", with preview and price history (v1.2 Phase 4) | No | Yes (tells you) | Yes | Yes |
| Refund exceptions (cash over £X, another cashier's sale, after N days, reason Other); refunds never blocked (v1.2 Phase 4) | No | Cashiers' | Cashiers' and managers' | All |
| Press "Problem?" (header and till): a chip, optional note, screen, role, device, version, online and queue counts (v1.2 Phase 8A) | Yes | Yes | Yes | Yes |
| Problem? inbox: read, mark fixed (the reporter is thanked with the version) or closed, logged; shows the reporter's role, never their name (v1.2 Phase 8A) | No | No | Yes | Yes |
| Usage record sent from their device: screens and active time, message titles, slow and failed calls, crashes, offline time and sale steps, by role and device, never by name; no screen text, typed values, money or names (v1.2 Phase 8B) | Yes | Yes | Yes | Yes |
| Friction Truths (pain per active hour, messages, active time and sale funnel by role, slow calls, device health) and the Monday top five (v1.2 Phase 8B/8C, Q18) | No | No | No | Yes |
| Ask arcarna: plain-English questions answered read-only from the shop's Evidence, only within the asker's role (each tool checks it again); never a customer's phone, email or address, never cost to a cashier; rate-limited per person (v1.2 Ask arcarna) | Yes (own figures, targets, stock) | Yes (plus Evidence, except staff pay and managers' performance) | Yes | Yes |
| Ask arcarna settings: monthly spend cap and dollar-to-pound rate (logged); the question log (who, role, when, tools, tokens, cost, scrubbed question; never answers) (v1.2 Ask arcarna) | No | No | Yes | Yes |
| Improvement-study setting (off by default, no recorder connected; staff see a banner on the chosen screens), logged (v1.2 Phase 8) | No | No | No | Change, logged |
| Suppliers, purchase drafts (and the PO PDF), goods receipts, replenishment, transfers | No | Yes | Yes | Yes |
| Stock levels (counts at their location, no cost; v1.2 Phase 3) | Yes | Yes | Yes | Yes |
| Credit List and Invoices (Q11) | No | Yes | Yes | Yes |
| "This customer already owes" at order start: one customer's total, tab count and oldest date; Take a payment (cash or card, today, up to what is owed) against it (v1.2.1) | Yes | Yes | Yes | Yes |
| Evidence and Truths (Q12) | No | Yes, except staff pay and managers' performance | Yes | Yes |
| Order Timing by person and Staff Performance, with Benefit (£), Speed and Fairness (v1.2 Phase 7; provisional for the first 2 weeks) | No | Cashiers and own; Admin cover and team totals | Everyone | Everyone |
| My performance and the weekly digest (v1.2 Phase 7C; own figures, commission, badges, override count; team median only at 4+; never cached) | Own only | Own; digest adds cashiers' rows | Own; digest adds everyone's | Everyone |
| Staff targets (v1.2 Phase 7C; red/amber/green/grey, no pay) | Read (colours) | Read | Change, logged and versioned | Change, logged and versioned |
| Loss-prevention patterns in Needs a look (v1.2 Phase 7C) | No | About cashiers | About cashiers and managers | All |
| Truths at a glance: read (widgets above their role hidden) | No | Yes, without Profit Truths | Yes | Yes |
| Truths at a glance: change the org's layout (v1.2 Phase 3) | No | No | Yes, logged | Yes, logged |
| Exports, including the product export (Q12) | No | No | Yes, logged | Yes, logged |
| Customer contact details (Q13a) | No | No | Yes | Yes |
| Customer: name, tier, points, masked phone and email (••4821, j•••@gmail.com; Q7, v1.2 Phase 5) | Yes | Yes | Full | Full |
| Customer: past-order summary and total spent (v1.2 Phase 5) | No | Yes | Yes | Yes |
| Customer: edit (points and total spent never typed; masked values never saved) | Create only | Name, email, address, tier, receipt switch; "Replace number" (logged) | All but points | All but points |
| Delivery address on the order: live / after completion (Q8a) | Yes / No | Yes / Yes | Yes / Yes | Yes / Yes |
| Driver's call: the customer's phone (Q8a, every reveal logged) | Assigned driver, out for delivery, until completed | Same as cashier | Always | Always |
| Ask for one customer's contact details (reason, 15+ character note, fields; v1.2 Phase 6) | No | Yes; one pending per customer; lapses after 48 h | Not needed | Not needed |
| Approve, decline or revoke a request (never your own; no emergency self-grant, Q9) | No | No | Yes | Yes |
| Inside a grant: reveal each field asked for by a tap, for 24 h from approval (every tap logged first) | No | The manager who asked; can end it early | — | — |
| "Message the customer instead" (approved WhatsApp templates, number never shown) and Credit List "Send payment reminder" | No | Yes, logged | Yes, logged | Yes, logged |
| Email an invoice (Resend; off with the reason when not set up) | No | Yes, logged | Yes, logged | Yes, logged |
| Customer data access log: one customer's Access history | No | No | Yes | Yes |
| Customer data access log: the org-wide page and the weekly line | No | No | No | Yes |
| Order history (Q10a) | Today, plus own last 7 days | All | All | All |
| Find a customer by phone: whole number, up to three, rate-limited per person | Yes | Yes | Yes | Yes |
| Shift sheets | Own only | Cashiers' and own | All | All |
| Pay settings: commission rates and switch, overhead mode, targets, "on time" timing (Q16) | No | Cashiers' pay, no rates; cannot change | Change, logged | Change, logged |
| Staff list (cashier profiles) | No | Yes, no PINs, no rates | Yes, no PINs | Yes, no PINs |
| Confirm a commission payment | No | Cashiers', never own | Cashiers', never own | Anyone's, never own |
| Scheduled Evidence | No | Yes | Yes | Yes |
| Issue a gift card (with a reason) | No | Yes | Yes | Yes |
| Needs attention: retry, edit, export or discard a refused till sale (discard logged) | No (sees the count) | Yes | Yes | Yes |
| Sign out with till sales unsent (logged) | No | Yes | Yes | Yes |
| Access log, recordings, managers' pay (Q13a) | No | No | No | Yes |
| Signals | Addressed to them | Cashier-related | All, including managers' | All |
| Allowed users, approvals | No | No | Yes | Yes |
| Worker logs, dead letters | No | No | No | Yes |

Everyone signs in as themselves (Q17); there are no shared till logins.

### Where it is enforced

- **Route table.** `shared/accessPolicy.ts` (`ACCESS_POLICY`) lists each locked
  route with its lowest role and the reason. Routes guard with
  `requireRole(...rolesAtLeast("MANAGER"))` so the table and the code use the
  same ranks.
- **Cost stripping.** `productForRole()` in the same file removes `costPrice`
  (and the other cost fields) from product and inventory reads for anyone
  below MANAGER. The key is removed, not nulled.
- **Role-matrix CI test.** `server/__tests__/roleMatrix.test.ts` requests every
  `ACCESS_POLICY` row as every staff role through the real route table and
  expects 403 exactly below the row's role. With a database it also seeds
  canaries — phone **07700 900123**, email **canary@example.invalid**, cost
  **£13.37** — plus a second org, then calls every GET route the app
  registers as a cashier and fails on any canary it finds. Leaks still being
  closed by another part of Phase 0B sit in `KNOWN_LEAKS` with their owner;
  that list may only shrink.
- **Evidence and Truths (Q12).** Every Evidence read (`/api/reports`,
  `/api/reports/:ref`), every Truths read (`/api/analytics/*`), the customer
  intelligence routes and the assistant's summary and alerts are MANAGER and
  above. The `ARC-T2-002` JSON (Staff Performance for
  everyone, unscoped) stays ADMIN and above (`EVIDENCE_REF_MIN_ROLE`). The
  Staff Performance page (`/api/evidence/staff-performance`, v1.2 Phase 7)
  is MANAGER and above with rows cut on the server: a manager sees cashiers
  and themselves, and is refused another manager's drill-down. Profit and expense
  Evidence (`/api/profit-analysis`, `/api/expense-report`,
  `/api/expense-analytics`) is ADMIN and above. The home page hides its
  Truths panel and Evidence picks below MANAGER, so cashiers do not land on
  refusals.
- **Exports (Q12).** Admin only, and every one writes an admin-audit row: the
  Evidence export (`export.evidence`), the page exports made in the browser
  (the toolbar records them through `POST /api/evidence/exports` first), the
  customer RFM export (`export.customers_rfm`), the customer and product bulk
  exports (`bulk.export`) and the payroll CSV (`export.payroll`). CSV cells
  that a spreadsheet would run as a formula are prefixed with `'`
  (`shared/csv.ts`).
- **Customer contact in Evidence (PRV-02).** Top customers, Customer Truths
  and the Credit List CSV carry no email; the command palette shows a
  customer's tier and points. Only the admin RFM export includes email.
- **Customer contact details (Q13a).** `GET /api/customers` and
  `/api/customers/:id` return phone, email and address to ADMIN and above
  only (`customerForRole`, `shared/accessPolicy.ts`). Below that the row
  carries `hasEmail`, `hasPhone` and `phoneLast4`, so the till can still pick
  a customer and offer an email receipt (the receipt worker reads the
  address itself), and its offline cache holds no contact details. An edit
  below ADMIN never blanks a contact field it could not see
  (`customerEditForRole`).
- **One customer view (v1.2 Phase 5, PRV-03).** Every staff read of a
  customer goes through `server/services/customerView.ts`: below ADMIN the
  query selects no contact column — the hints and masks are made in the
  database. `scripts/audit-contact-fields.mjs` fails CI when a contact column
  is read anywhere else not on its allow-list. The Operations board and its
  live stream carry no phone for anyone; the driver asks for it
  (`POST /api/orders/:id/customer-phone`, logged in the customer data access
  log as `driver_call` since Phase 6, `Cache-Control: no-store`). "Use saved
  address" is logged (`saved_address`), as is a manager's "Replace number"
  (`phone_replaced`, written before the number is changed). The public API returns contact
  details only to a key with the `customers:read_contact` permission.
- **Contact-details requests and the access log (v1.2 Phase 6, PRV-09/10/11).**
  A MANAGER asks for one customer's details (`POST
  /api/customers/:id/contact-requests`): reason code, a note of at least 15
  characters, the fields wanted, optionally the order. One pending request per
  customer per manager (a partial unique index); it lapses after 48 hours. It
  arrives as a Signal to admins and the owner and in Needs a look, where an
  ADMIN or SUPER_ADMIN approves, declines or revokes; nobody decides their own
  request, and nothing else opens a grant (no emergency self-grant, Q9). The
  grant is 24 hours from approval, for the fields asked for, for the manager
  who asked; they can end it early. Each field is revealed by a tap (`POST
  /api/customers/:id/reveal`, no-store): the log row is written first and the
  reveal fails if it cannot be. The app keeps revealed values in the open
  dialog only and clears them at expiry. "Message the customer instead" is
  offered first: the server sends an approved WhatsApp template (order ready,
  delivery update, payment reminder, "please call us on <shop number>") to the
  number on file and never returns it; unapproved local templates are
  refused, here and in the WhatsApp inbox. Invoices are emailed by the server
  through Resend. Everything that touches contact details goes in
  `customer_access_log` (`server/services/customerAccessLog.ts`): reveals, the
  driver's call, "Use saved address", replaced numbers, exports (one row per
  customer), requests and decisions, messages and emailed invoices, and API
  keys reading contact details. Admins see a customer's rows on the Contact
  dialog's Access history tab; the owner sees the org-wide page
  (`/customer-access-log`) and gets a Monday Signal with the week's line.
- **My run (v1.2).** `GET /api/my-run` returns the signed-in person's own
  ready and out-for-delivery deliveries; a manager may pass `?driver=` to view
  someone else's (read-only), anyone below gets 403. It carries names and
  addresses, never a phone (Call is the logged reveal above), and is
  `Cache-Control: no-store`. `PUT /api/my-run/order` saves only the caller's
  own stop order for the trading day. `POST /api/orders/:id/couldnt-deliver`
  is the assignee's or a manager's: it puts the delivery back to ready, leaves
  a note on the board card, sends a `delivery_failed` Signal to managers and
  is logged (`order.delivery_failed`). The phone keeps a copy of the last
  loaded run (no phone numbers) and queued Delivered / Couldn't deliver taps,
  per person; sign-out clears the copy.
- **Device copies, exports and webhooks (v1.2 Phase 5, PRV-07, FIX-14,
  CMP-14).** The till's offline store keeps the cashier view only
  (`deviceCustomerRow`), whoever was signed in, and cuts rows left by older
  versions on open; queued customer edits and the Customers form's draft hold
  no contact details (`withoutContactDetails`). Customer, WhatsApp, export
  and lookup responses are `Cache-Control: no-store`, and the service worker
  never stores customer, credit, invoice, WhatsApp, export or lookup
  responses, nor anything marked no-store (`client/public/sw.js`). The
  WhatsApp inbox list and conversations are staff only. Every CSV goes
  through `shared/csv.ts` (every cell quoted, formula characters neutralised,
  UTF-8 marker; `shared/csv.spec.ts` fails on a hand-built one). Outbound
  webhooks send an explicit payload per event (`shared/webhookPayload.ts`):
  customers by id only; staff and expense events are not offered.
- **Expense lists.** `GET /api/overhead-expenses` and
  `GET /api/orders/:orderId/expenses` are MANAGER and above: a personal-use
  sale books its stock at cost as an order expense.
- **Staff filter.** Daily Sales, Weekly Sales and Weekly Margin filter by the
  person who completed the order (`orders.completed_user_id`, `?staffId=`),
  listed by `GET /api/evidence/staff` (names and ids only). A MANAGER may
  filter by cashiers and themselves only; filtering by a peer manager or an
  admin is managers' performance (Q12) and answers 403
  (`mayFilterEvidenceBy`, `server/services/evidenceStaff.ts`). Before 27 August
  2026 that person was inferred from who opened the shift (migration 057), and
  the pages say so. An old `?cashierId=` link is refused.
- **Payroll (Q12, Q13a).** One row per person, with sales per active hour
  (first to last action on the shift). MANAGER and ADMIN see cashiers' rows
  and their own; managers' pay is SUPER_ADMIN only (`canSeePayRow`,
  `shared/reports/payroll.ts`). The route that opened coded shifts
  (`POST /api/cashier-shifts/start`) is retired.
- **Staff and pay (STF-FN4, FIX-10).** Shift sheets — the till Z-report
  (`/api/shifts`, `/api/shifts/:id/report`) and the cashier balance sheet
  (`/api/cashier-shifts`, `/:id/summary`, `/current/:cashierId`) — follow
  `maySeeShiftSheet` (`shared/staffPolicy.ts`): a cashier's list is filtered
  to their own shifts in the query and a colleague's sheet is a 403. Closing
  a till shift or ending a cashier shift returns its sheet, so it follows the
  same rule. The cashier balance sheet itself goes through
  `shiftSheetForRole`: a cashier's own sheet has no cost, profit, overhead or
  expense fields, and the commission rate is admin only. The staff
  list (`GET /api/cashiers`) is MANAGER and above; the PIN never leaves the
  server for anyone (`hasPin` says whether one is set) and the commission
  override is ADMIN and above (`cashierProfileForRole`). The commission list
  and payments are filtered by `canSeePayRow`, and the rate a shift was paid
  at is admin only. Nobody confirms their own commission payment, and below
  SUPER_ADMIN only cashiers' (`mayConfirmCommissionPayment`). When a payment
  names a shift, the payee is whoever that shift belongs to; a payee the
  client sends that disagrees is refused. The commission
  switch, default rate, overhead mode and the four "on time" minutes
  (`ADMIN_ONLY_SETTING_KEYS`) are refused to a manager through
  `PATCH /api/org/setup` when they would change, and every change writes an
  admin-audit row with the old and new value (`org.pay_setting.changed`,
  `org.timing_setting.changed`); the default rate is left out of
  `/api/settings` and `/api/org/setup` below ADMIN. Scheduled Evidence lists
  and run history are MANAGER and above.
- **Credit, gift cards and marketing (FIX-12, FIX-13, PRV-14, Q11).** Every
  Credit List route (`/api/tick-customers*`, `/api/credit/*`) and every invoice
  route (including `POST /api/invoices/for-order/:orderId`, v1.2 Phase 1C) are
  MANAGER and above, and the Control Centre leaves credit totals
  out below MANAGER. The till's exception (v1.2.1): every staff role reads
  one customer's total, tab count and oldest date
  (`GET /api/customers/:id/credit-summary`) and takes a cash or card payment
  against it, today only (`POST /api/customers/:id/credit-payments`), through
  the same oldest-tab-first repayment path, recorded whole or not at all. A credit payment's method must be cash, card or transfer.
  It may be dated up to `BACKDATE_LIMIT_DAYS` (7) back, never ahead, and only
  by a manager (`shared/creditPolicy.ts`). Clearing a whole tab
  (`/mark-paid`) needs the exact balance being cleared and a "Paid by" method
  (v1.2 Phase 1C). A card or transfer
  payment recorded below ADMIN raises a `credit_payment` Signal with the
  recorder as its subject, so it reaches the people above them. Issuing a
  gift card is MANAGER and above and needs a reason, kept on the audit log;
  `POST /api/gift-cards/:code/redeem` is now `/validate` (it never moved
  money). WhatsApp templates in the MARKETING category, or of unknown
  category, are refused until the customer's marketing consent is recorded —
  and nothing records it yet (`shared/marketingConsent.ts`).
- **Needs attention (v1.2 Phase 1A).** A till sale the server refuses is
  reported to `POST /api/sale-issues` by the till (any till role) and listed
  at `GET /api/sale-issues` for MANAGER and above. A retry or an edit is
  `POST /api/orders` with `saleIssueId`, MANAGER and above, and keeps the
  sale's own reference, so it cannot land twice. A discard needs a reason and
  writes `sale_issue.discarded` (with the whole sale) in the same transaction.
  Signing a till out while sales are unsent is blocked; a manager may
  override, and `till.sign_out_override` is written before the till signs out.
- **Signals.** Every Signal is raised through `notify()`
  (`server/services/signals.ts`) with an audience — a minimum role, a list of
  roles, or named people — and, when it names a member of staff, that person
  as its subject. Routing lives in `shared/signals.ts` (`SIGNAL_ROUTES`):
  existing Signals go to managers, commission paid to admins. A Signal that
  names someone reaches only people who outrank them (never team-wide) and
  not the person themselves unless `tellSubject` is set. The recipient lookup
  always includes SUPER_ADMIN logins, whose `org_id` is NULL. Recipients are
  stored per person (`org_notification_recipients`, migration 072), so read
  and cleared are per person, and the read route re-checks the viewer's
  current role. Stock warnings are for managers, account approvals for
  admins, and worker dead letters (not scoped to one org) for SUPER_ADMIN only.
- **Dev bypass.** With `DEV_AUTH_BYPASS=1` (`npm run dev`), `requireRole` lets
  everything through. Use Preview as role (Phase 0B part 10) or the role-matrix test to see
  what a role really gets.

## Roles

| Role | Description | Org scope |
|------|-------------|-----------|
| **SUPER_ADMIN** | Platform owner | Must pass `X-Org-Id` or `?orgId=` to scope; no global view |
| **ADMIN** | Organisation administrator | Scoped to their org |
| **MANAGER** | Store manager | Scoped to their org |
| **CASHIER** | Point-of-sale operator | Scoped to their org |
| **CUSTOMER** | Shop (website) account | Refused on every staff route; shop routes only |

## Org/Store Scoping Rules

- **Locations = stores** – One org can have many locations.
- **No cross-org access** – A user in Org A cannot query or modify Org B data.
- **SUPER_ADMIN** – Must explicitly pass `X-Org-Id` or `?orgId=` to scope. No global view (prevents data breach).
- **Other roles** – Must have `orgId` assigned. Requests are always scoped to their org.
- **Locations CRUD** – SUPER_ADMIN and ADMIN only.
- **Locations list (`GET /api/locations`)** – Readable by every org role, because opening a
  POS shift requires picking a location. MANAGER and CASHIER get the trimmed picker shape
  (`id`, `name`, `isActive`, `isDefault`); only SUPER_ADMIN/ADMIN get the payload with
  per-location revenue and order stats.

## Request Context

After `requireOrgContext`, `req.orgContext` contains:

- `orgId` – Current org scope (required for all scoped routes; SUPER_ADMIN must pass header/query)
- `locationId` – Optional store scope from `X-Location-Id` or user default
- `role` – User’s role

Headers:

- `X-Org-Id` (SUPER_ADMIN only) – Scope to a specific org. Ignored for every other role, which is always scoped to its own `orgId`.
- `X-Location-Id` (any authenticated, org-scoped caller) – Scope to a specific store within the caller's org. `requireOrgContext` reads this header unconditionally (falling back to the user's `defaultLocationId`, then the open-shift location, then the org's default) — it is not gated to SUPER_ADMIN.

## Promote/Demote Users

1. **Allowed users** – Stored in `allowed_users` with `replit_user_id`, `org_id`, `role`.
2. **Promote** – Update `role` (e.g. CASHIER → MANAGER) and optionally `org_id`.
3. **Demote** – Update `role` to a lower level.
4. **SUPER_ADMIN** – Only one platform owner; `org_id` is null.
5. **Admin UI** – `/api/admin/allowed-users` (ADMIN/SUPER_ADMIN only) to manage users.

## Migration from Legacy Owner

- `isOwner = 1` in `allowed_users` maps to `role = 'SUPER_ADMIN'`.
- First user to log in becomes SUPER_ADMIN if no owner exists.
- Run `npm run seed` after `npm run db:push` to create org, location, roles, and sample products.

## Operations Centre (Phase N)

All under `scoped`. Several rows depend on the ROW, not a static role list — "own"
means the order is currently assigned to the actor, or the actor is the one who
completed / marked it ready — so these live in-handler
(`assertTransitionRoleAllowed`, `server/services/orderTransitions.ts`), not in a
`requireRole(...)` middleware. The CI gate for this table is
`server/__tests__/orderTransitionRoles.test.ts` (`captureRoutes` / `runGuard` for
the plain `requireRole` rows, direct calls to `assertTransitionRoleAllowed` for
the row-dependent ones).

| Action | CASHIER+ | MANAGER+ only |
|---|---|---|
| `claim`, `unclaim` (own), `ready`, `arrived`, `out_for_delivery`, `complete`, `hold`, `unhold`, `set_due`, `reopen` ≤ 10 min (completer), `unready` ≤ 10 min (the person who marked it), station / break (self), `assign` when passing on one's own order | ✓ | |
| `assign` to someone else, `unclaim` someone else's, `reopen` / `unready` after 10 min or of someone else's, station for others, PUT / DELETE `/api/orders/:id` | | ✓ |

- `POST /api/orders/:id/transition` — every action above CASHIER+ unless the row
  says otherwise (server/routes/orderTransitions.ts).
- `GET /api/operations/staff` — any signed-in org member.
- `PATCH /api/operations/station` (self) — CASHIER+, own row only.
- `PATCH /api/operations/station/:userId` — MANAGER+, audited (`ops.station_set`).
- Alert acknowledgement (`PATCH /api/operations/alerts/:id/ack`,
  `POST /api/operations/alerts/ack-all`) is N5a's, not built yet.

## Preview as role (Phase 0B, CMP-09)

A SUPER_ADMIN or ADMIN can view the app as a MANAGER or CASHIER ("Preview as"
in the header). The browser sends `X-Preview-Role` (or `?previewRole=` for the
board stream); `server/auth/previewRole.ts` then runs that request as the
previewed role, pinned to the admin's org (the owner's picked org), so every
check in this file applies exactly as for a real manager or cashier.

- Read only: any request other than GET/HEAD/OPTIONS is refused
  (`PREVIEW_READ_ONLY`). Real permissions never change.
- Refused for MANAGER, CASHIER and CUSTOMER (`PREVIEW_NOT_ALLOWED`); only
  MANAGER and CASHIER can be previewed.
- Start and end are audit-logged (`preview_role.started` / `preview_role.ended`,
  `POST /api/auth/preview-role`).
- CI gate: `server/__tests__/previewRole.test.ts`.

## Shop privacy notice (Phase 0B, PRV-15)

- `PATCH /api/settings` privacy fields — ADMIN+, audit-logged (`shop_privacy.updated`).
- `GET /api/public/privacy-notice` — public (no sign-in): only what the owner published.
