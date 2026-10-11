# ARC-BUG-18 — cash refunds without a till shift

QA source: https://app.notion.com/p/3e1c5e2d061d816c8d00c530f880d33f

Base: `2ffbdd211eb0ffc74ca1a2de6facb80ea3581074` (current main on 11 October 2026).
Base CI: https://github.com/andydp4/ARCARNA/actions/runs/38000980468 — successful.

## Behaviour and decision

Back-office refunds deliberately do not open phantom drawers (ARC-015). A
refund without the issuer's own active drawer retains `shiftId = null`.
Neither the original sale's drawer nor its location proves where cash was
paid out. Automatically deducting that refund from a cashier's expected cash
would invent attribution, and can hide a genuine shortage.

The correction uses the QA record's explicit exception-list option:

- Shifts shows managers an organisation-wide cash-refund reconciliation list,
  even when no shift exists. It covers every date and location, includes cash
  amounts, refund/order references and timestamps, and supports pages of 100.
  Aggregate count and cash total always include all matching refunds.
- Every Z-report and shift-close response carries an organisation-wide
  unassigned cash-refund summary. The rendered report (including print) and
  close notification warn that reconciliation needs review. This is a current
  exception snapshot, not a refund total attributed to the report's shift.
- Card, store-credit and tab-only refunds are excluded. For a mixed tab/cash
  refund, only `max(0, total - max(0, creditAmount))` is missing cash. `original`
  follows the existing normalised cash-refund rule.
- Unassigned cash is not deducted from any drawer, net sales or variance.
  Existing stored expected cash and variance are not rewritten. A manager
  must establish the actual source of a payment before relying on a shortage
  as evidence against a cashier.

This makes legacy exceptions visible without a migration or financial
backfill. An audited assignment/resolution workflow is a separate change;
exceptions remain visible while their `shiftId` is null. This PR does not
claim to repair historical attribution or to reconcile unknown drawers.

## Calculation and transaction trace

`server/routes/refunds.ts` resolves the refund tender and tab reduction, then
writes under the order lock with the existing ceiling and quantity checks.
It now resolves soft drawer attachment inside that transaction, taking a
share lock before the order lock. `server/routes/shifts.ts` closes under the
drawer's update lock. A refund that holds the lock first commits before cash
is counted; a close that holds it first leaves the later refund unassigned.
No refund can be stamped into a counted drawer after its expected cash is fixed.

The linked-refund query remains restricted to the actual shift and is now
explicitly tenant scoped. `buildZReport` computes drawer cash as:

`opening float + paid cash tender legs - linked cash refunds + stamped cash tab repayments`

Shift close persists that figure and `closing count - expected cash`. Stored
figures take precedence when viewing old closed shifts. Unassigned cash is a
separate exception summary and cannot be subtracted twice across drawers.

The 06:00 daily-close service closes logical cashier shifts, leaves physical
drawers open for counting and publishes day totals/signals; it does not
persist physical drawer expected cash. Revenue and commission already net
refunds by refund/order records, not by this optional till-shift attachment.
Those paths are unchanged. This correction targets physical till reconciliation.

## Validation

- 68 targeted tests pass across 9 suites, including 14 new real-database
  reconciliation tests, both forced refund/close race orderings, original soft
  attachment tests, tender rules, Z-report arithmetic, credit repayments,
  cash-up invoices and rendered warning/print markup.
- The no-shift regression fails on unchanged main. The new DB suite and the
  original soft-attachment suite are added to CI's explicit `unit-db` list.
- TypeScript, client/server build and the repository's static audits pass.
- Broad no-database test run has one unrelated failure: the safeUrl suite's
  public example.com DNS lookup fails in this restricted runtime. The same
  failure is reproduced on unchanged main. DB suites are intentionally skipped
  in that run; the relevant ones are run explicitly against local PostgreSQL.
- Local DB validation used a disposable PostgreSQL 18.4 runtime, with its
  initial root-user guard adapted for the root-only sandbox; SQL, transaction
  and locking behaviour were unchanged. Repository CI uses PostgreSQL 16 and
  Node 20; the local Node version was 24.19.0. PR CI is the version-parity check.

No merge, deployment, monitoring change or production financial-record edit
is part of this correction.
