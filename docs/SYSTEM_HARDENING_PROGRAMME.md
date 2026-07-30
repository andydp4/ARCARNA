# System hardening programme

Status: **Phase 0 complete.** Phases 1–7 not started.

This document exists because a fully-built backend flow (replenishment →
purchase draft → receiving) shipped with every link between its stages broken,
and 216 passing tests plus a green CI did not notice. It records why that was
possible, and the checkpoint sequence to close it.

**Rule for this programme: a checkpoint is only ticked when a command proves it.**
No checkpoint is ticked because code "looks right" or because an element exists
on screen. Every box below names the evidence that closes it.

---

## Part 1 — Why this was missed

Not carelessness by any one change. Four structural causes:

### 1.1 Nothing in CI has ever exercised a user journey

The entire end-to-end suite is **3 tests, 26 lines** (`tests/e2e/smoke.spec.ts`):

| Test | What it proves |
|------|----------------|
| `GET /api/health` returns ok | the server boots |
| `GET /api/auth/runtime` exposes dev bypass | auth config is readable |
| SPA shell loads at root | React mounts |

No test clicks a button. No test follows a link. No test creates an order,
raises a draft, or receives goods. The a11y suite (`tests/a11y`, 38 lines) checks
axe violations — accessibility, not function.

So the 216 unit tests and the E2E suite were *both* green while the flow was
unusable, because **no test ever navigated from one page to another.** That is
the whole gap. A link reading `href="/inventory"` with a `title` attribute
telling the user to navigate the rest of the way by hand cannot fail a suite
that never clicks anything.

### 1.2 Unit tests covered pure logic, which is where bugs weren't

The 216 tests concentrate on parsers, templates, token logic, and service
arithmetic. Those are the parts that were correct. The defects lived in:

- link construction (`/inventory` with no tab param)
- response handling (`res.id` on a `Response`)
- cache invalidation (query-string keys escaping the invalidator)
- cross-stage data flow (replenishment not reading purchase state)

None of that is reachable by a unit test of a pure function.

### 1.3 Documentation was treated as a completion signal

`docs/WORKFLOW_PURCHASE_RECEIVING.md` claimed, under "Phase 12 hardening
applied":

> Receiving history on purchase draft detail; purchase draft link on receipt detail

Both *elements* existed. Neither *worked* — the draft link went to
`/purchase-drafts` with no id, the receipt link to `/inventory` with no tab. The
doc recorded that the UI had been added, not that the path had been walked. A
later reader (human or agent) reasonably treats that as done.

### 1.4 No mechanical check for "backend exists, UI seam missing"

This is a whole defect *class*, and nothing looked for it. Confirmed instances
beyond the replenishment flow, found in minutes once looked for:

- `/api/invoices/:id/pdf` exists, called **only** from the Invoices page — you
  cannot download an invoice from the order it belongs to
- **no receipt download endpoint exists at all** — receipts render only as email
  HTML and a settings preview
- product import showed **"Imported: undefined, Failed: undefined"** (`Response`
  read as JSON) — same root cause as the draft toasts

### Phase 0 — what has been done about it ✅

- [x] `scripts/audit-ui-wiring.mjs` — mechanical detector for the class:
      dead client links, mutation results read without `.json()`, and orphan API
      routes (advisory). Wired into CI and `npm run audit:wiring`.
      *Evidence:* `node scripts/audit-ui-wiring.mjs` exits 0; CI step added.
- [x] Fixed the real bug it found: product import toast reporting `undefined`.
      *Evidence:* audit check 2 clean; `npx tsc --noEmit` clean.
- [x] Normalised three mixed-return-type mutations (`customers` ×2, `expenses`)
      where offline returned an object and online a `Response`.
- [x] Replenishment flow itself: netting, grouping, deep links, provenance,
      invalidation — 17 integration tests + 22 unit tests.

> **Calibration note:** the detector's first version reported 47 hits. Manual
> inspection showed most were false positives (a `mutationFn` that already calls
> `res.json()` is correct). It was rewritten to check what `mutationFn` actually
> returns, and reported 5 — of which 5 were genuine. **An audit that cries wolf
> is worse than none; every future check below must be calibrated the same way
> before its number is believed.**

---

## Part 2 — The demand, honestly assessed

The stated bar is 99.9%, no declaring done early. Two things must be said plainly
so the number means something:

1. **"Every function end-to-end, verified in the UI" is a programme, not a task.**
   226 API routes × 62 client routes. Done properly — write the journey, run it,
   watch it fail, fix, re-run — this is multiple sessions of work. Anyone who
   tells you they have swept all of it in one pass has not.

2. **"All green" is only meaningful if the tests can go red.** The current suite
   is green *right now* and the system had a broken flow. Adding assertions that
   pass trivially would raise the number and lower its value. So each phase below
   is defined by *journeys walked*, not tests added, and every phase requires a
   deliberately-failing check first (see the mutation gate in 3.8).

What I will not do is report a percentage I cannot evidence. Progress here is
"N of M journeys proven", which is countable.

---

## Part 3 — Checkpoint sequence

Ordering is deliberate: money-handling and data-integrity paths first, cosmetics
last. Each phase ends with a committed, runnable proof.

### Phase 1 — Journey harness foundation
- [ ] 1.1 Playwright fixture: seeded org, location, products, supplier, roles
- [ ] 1.2 Auth helper for each role (SUPER_ADMIN / ADMIN / MANAGER / CASHIER)
- [ ] 1.3 Assertion helpers: toast text, table row state, downloaded file type
- [ ] 1.4 **Prove the harness can fail** — assert a known-false thing, see red,
          then correct it. *Evidence: screenshot/log of the intentional failure.*
- [ ] 1.5 CI job running the journey project separately from smoke

### Phase 2 — Money paths (highest risk)
- [ ] 2.1 POS: add item → pay cash → order completes → stock decrements
- [ ] 2.2 POS: card, split, and partial payment variants
- [ ] 2.3 Refund: full refund caps at `settledTotal`, stock returns
- [ ] 2.4 Refund: partial, then second refund cannot exceed remainder
- [ ] 2.5 Gift card: issue → redeem → balance correct → cannot double-redeem
- [ ] 2.6 Shift: open → orders → close → Z-report totals reconcile to orders
- [ ] 2.7 Negative: refund a refunded order, redeem a spent card, close a closed
          shift — each rejected with a visible message, not a silent no-op
- [ ] 2.8 Concurrency: two simultaneous redemptions of one card — exactly one wins

### Phase 3 — Documents: receipts, invoices, report PDFs
- [ ] 3.1 Inventory every document producer and its trigger *(started — see Part 4)*
- [ ] 3.2 Receipt: email path renders with org logo and name
- [ ] 3.3 Receipt: **download endpoint does not exist — build it** (Part 5)
- [ ] 3.4 Invoice PDF: opens from Invoices page, non-zero bytes, valid PDF header
- [ ] 3.5 Invoice PDF: **reachable from the order it belongs to** (Part 5)
- [ ] 3.6 Invoice PDF: logo present when `invoiceLogoEnabled`, absent when off
- [ ] 3.7 Every report PDF export: one journey each, assert non-empty + branded
- [ ] 3.8 **Mutation gate:** blank the org logo, confirm a branding test goes red.
          A branding assertion that passes with no logo is not an assertion.
- [ ] 3.9 Numbers on the PDF equal numbers on screen for the same filter

### Phase 4 — Cross-stage flows (the class that failed)
- [ ] 4.1 Replenishment → draft → receive, walked in the browser end to end
- [ ] 4.2 Transfer: draft → dispatch → receive, stock moves between locations
- [ ] 4.3 Order → invoice → payment recorded
- [ ] 4.4 Customer → loyalty accrual → redemption
- [ ] 4.5 Promotion → applied at POS → lift report reflects it
- [ ] 4.6 For every remaining multi-stage flow, one journey that crosses the seam
- [ ] 4.7 Extend the wiring audit: flag any `<Route>` no navigation reaches
          (orphan *pages*, the mirror of orphan endpoints)

### Phase 5 — Permissions and tenancy (security)
- [ ] 5.1 Every mutating route: CASHIER role rejected where it should be
- [ ] 5.2 Cross-org read attempt on every `:id` route returns 404, never data
- [ ] 5.3 Cross-org write attempt rejected; verify no partial write landed
- [ ] 5.4 Unauthenticated access to every route → 401, no body leakage
- [ ] 5.5 IDOR sweep: enumerate ids across orgs, assert zero leaks
- [ ] 5.6 Header/param org-scope override (`orgScopeHeaders`) cannot be forged
      by a client to reach another tenant
- [ ] 5.7 Input validation: oversized payloads, wrong types, injection strings,
      negative quantities, and unicode on every zod schema
- [ ] 5.8 Rate limiting / abuse on auth and webhook endpoints
- [ ] 5.9 Webhook signature verification cannot be bypassed
- [ ] 5.10 Secrets: confirm none reach client bundles (`grep` built assets)

### Phase 6 — Data integrity under stress
- [ ] 6.1 Idempotency: replay every completion/settlement endpoint twice
- [ ] 6.2 Rollback: force failure mid-transaction, assert no partial state
- [ ] 6.3 Concurrency: parallel stock movements on one product+location
- [ ] 6.4 Offline queue: mutate offline, reconnect, assert exactly-once sync
- [ ] 6.5 Migration: fresh DB and upgrade-from-current both reach same schema
- [ ] 6.6 Reconciliation query: stock == sum(movements) for every product

### Phase 7 — UX completeness
- [ ] 7.1 Every mutation has a visible success *and* failure state
- [ ] 7.2 No dead-end: every created record is reachable from where it was made
- [ ] 7.3 Empty, loading, and error states on every list
- [ ] 7.4 Keyboard and mobile pass on money paths
- [ ] 7.5 Reduce the 184 pre-existing lint errors (a11y) toward zero

---

## Part 4 — Document/branding findings so far

Investigated in Phase 0; feeds Phase 3.

| Producer | Branded? | Reachable from |
|----------|----------|----------------|
| Invoice PDF (`pdfGenerator.ts`) | Yes — logo + company block, gated on `invoiceLogoEnabled` | Invoices page **only** |
| Receipt HTML (`templates/receipt.html.ts`) | Yes — `org.logoUrl` + name | Email worker; settings preview |
| Report PDFs (`reportPdf.ts`) | Brand palette, matching `/reports` | Report pages |
| **Receipt download** | — | **does not exist** |

So: branding is implemented in the templates and wired for the paths that exist.
Two caveats before Phase 3 can tick:

1. Verified by **reading code, not by opening a PDF.** Untested until 3.4/3.6.
2. Invoice logo requires `invoiceLogoEnabled` *and* a `logoUrl`; if either is
   unset the invoice renders unbranded and silently. Needs a settings-level
   warning (Phase 3.6).

---

## Part 5 — New feature: download receipt & invoice at completed order

Confirmed as a genuine gap, and an instance of the same class.

**Server**
- [ ] 5.1 `GET /api/orders/:id/receipt.pdf` — new; render receipt template → PDF
- [ ] 5.2 `GET /api/orders/:id/invoice.pdf` — resolve the order's invoice and
          reuse the existing generator; 404 with a clear message if none
- [ ] 5.3 Both org-scoped, role-checked, and 404 across tenants (Phase 5 rules)

**Client**
- [ ] 5.4 Download receipt + download invoice buttons on the completed order
- [ ] 5.5 Disabled with a reason when no invoice exists yet
- [ ] 5.6 Same actions in POS post-payment confirmation

**Proof**
- [ ] 5.7 Journey: complete an order → click each → assert a valid, non-empty
          PDF with the org's name in its bytes
- [ ] 5.8 Cross-tenant: another org's order id returns 404

---

## Definition of done

Done is reported when, and only when:

1. Every box above is ticked, each by a named command or artefact.
2. `npm run check`, `npm test`, `npm run audit:wiring`, `npm run test:e2e` are
   green, **and** the mutation gates in 1.4 and 3.8 have been shown to go red
   when the thing they check is broken.
3. The count of proven journeys is stated as a number, not a percentage.

Until then this document states the current phase, and nothing is described as
finished that has not been walked.
