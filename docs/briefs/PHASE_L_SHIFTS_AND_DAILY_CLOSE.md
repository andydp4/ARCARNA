# Phase L — Shifts as trading days, and the daily close

**Status (2026-08-26):** Briefed, not started · **Depends on:** Phase K (K1–K7)

Five briefs: **L1** commission moves from cashier codes to user accounts, **L2** a
shift becomes a trading day opened at login, **L3** the 06:00 daily close, **L4**
the Z-report-so-far button, **L5** the Open Orders redesign.

L1 first and alone — it changes who money is attributed to, and everything after
it reads that attribution. L2 depends on L1. L3 depends on L2 for the shifts it
closes. L4 and L5 are independent of each other once L2 is in.

---

## Why this phase exists

Phase K rebuilt what commission *is*. This phase changes who earns it and when
the books close.

Today a cashier opens a shift by hand, picks a location, and picks a cashier
code from a dropdown. Commission then attaches to that code — a `cashier_profile`
row, which is a code, a display name and a PIN, and which has no connection
whatsoever to the user account the person logged in with.

The business does not work that way. People log in and start serving. Several
are on at once. Orders get loaded by whoever is free and completed by whoever
takes the payment. Nobody wants to pick a code from a list first, and nobody
wants to remember to close a shift at the end of the night — the day should
close itself.

---

## Decisions locked

| Rule | Value |
|------|-------|
| Starting a shift | Automatic, at login. There is no open-shift step |
| Who commission belongs to | The **user account**. Cashier codes are dropped |
| Concurrency | Everyone can be logged in and taking orders at once |
| Who loaded an order | The user who created it, recorded against their shift |
| Who earns on it | The user who completes it in Open Orders — the 90/10 split from K2 is unchanged, so the completer takes 90% and whoever loaded it takes 10% |
| What ends a shift | The **06:00 cut, and only that**. Logging out for a break and back in is the same shift |
| A shift, therefore | One user, one trading day. Not a login session |
| Trading day | 06:00 to 06:00, in the organisation's timezone |
| At 06:00 | The system totals the previous trading day, closes its shifts, and issues the Signals and reports |
| Seeing where you are | A button on the till shows the Z-report for your shift so far |
| Open Orders | Redesigned — it is where completion happens, so it is where commission is earned |

**The one thing to be careful about:** "whoever completes the order gets the sale
commission" is the 90% completer share from K2, not a change to the split. The
inputter's 10% stands.

---

## What the code does today, and where it conflicts

| # | Finding | Where |
|---|---------|-------|
| **G1** | **Cashier profiles have no link to a user.** The table is a code, a display name, a PIN and a rate. Nothing joins it to `users`, so "which user made this order" cannot be derived from the cashier code on it. The only bridge for historic rows is `cashier_shifts.opened_by_user_id` — who was logged in when that shift was opened | `shared/schema.ts` (`cashierProfiles`) |
| **G2** | **`cashier_shifts.cashier_id` is NOT NULL** and references `cashier_profiles`. A shift cannot currently exist without a cashier code, so shifts-per-user needs that column changed, not just ignored | `shared/schema.ts` (`cashierShifts`) |
| **G3** | **Day bucketing is UTC.** `utcDateKey` slices an ISO string, and `dayBounds` builds `T00:00:00.000Z`. A 06:00 cut in Europe/London is 05:00 UTC under British Summer Time, so a UTC-midnight bucket both mis-attributes every order taken between midnight and 06:00 and drifts by an hour twice a year | `shared/reports/cashierShiftReport.ts:285`, `server/services/cashierShiftEngine.ts:332` |
| **G4** | **Auto-close is inactivity-driven** — `shiftInactivityCloseAfter` offers 1 hour / 12 hours / 1 day / never. That directly contradicts the locked rule: a cashier who logs out for lunch must come back to the same shift, and an idle till must not close the day early | `server/services/cashierShiftEngine.ts:591` |
| **G5** | **Order creation is gated on a manually opened shift** by `requireOpenShift`, and the modal that opens it just gained a location and cashier-code picker in PR #139. Both the gate and the modal are on the way out | `server/middleware/requireOpenShift.ts`, `client/src/pages/pos/shift-open.tsx` |
| **G6** | **Attribution depends on an `X-Cashier-Id` header.** No header, no cashier, no commission — which is why a web order has no inputter today. Under the new model the logged-in user is always known, so attribution should never be missing on a till sale | `server/middleware/requireActiveCashierShift.ts` |
| **G7** | **There is already an idle-aware worker loop.** The 06:00 close belongs there as a periodic check, not in a new scheduler — the repo has no cron and does not need one | `server/workers/index.ts:260`, `server/index.ts:209` |
| **G8** | **User identity is a string, not a foreign key,** across the shift tables — `opened_by_user_id` is `varchar(255)`. New user columns should match rather than invent a second convention | `shared/schema.ts` (`cashierShifts`) |

---

## Open questions

**Blocking L1:**

1. **What happens to the existing cashier codes and their rates?** The per-cashier
   commission rate lives on `cashier_profiles.default_commission_rate`, and there
   is no way to map a code to a user (G1). **Proposed:** add a commission rate to
   the user record; keep `cashier_profiles` read-only for historic reports; drop
   Settings → Cashiers from the nav. Someone has to set each user's rate once
   after the change, because the old rates cannot be moved automatically.

**Non-blocking, defaults proposed:**

2. **Who gets a shift?** Proposed: any user who creates or completes an order,
   opened lazily on that first action rather than at login itself — an admin
   reading reports at midnight should not open a trading day.
3. **The 06:00 cut's timezone.** Proposed: the organisation's timezone
   (`organizations.timezone`, default Europe/London), not UTC. This is what G3
   is about.
4. **A day with no trading.** Proposed: no shift, no Z-report, and the daily
   close says nothing rather than issuing an empty report.
5. **Open Orders redesign** has no specification beyond "looking better". L5
   proposes one; it should be agreed before it is built.

---

## Brief L1 — Commission belongs to the user, not a cashier code

**Goal:** Attribute orders and commission to the logged-in user account, and
retire cashier codes as the unit of attribution.

**Touch:**

- `+ migrations/057_commission_by_user.sql` — `orders.input_user_id varchar(255)`, `orders.completed_user_id varchar(255)`; `cashier_commission_entries.user_id varchar(255)`; `cashier_shifts.user_id varchar(255)`, and `cashier_shifts.cashier_id` made nullable; `users.commission_rate numeric(5,2)`; backfill from `cashier_shifts.opened_by_user_id`
- `~ shared/schema.ts` — the new columns; `cashierProfiles` marked legacy
- `~ shared/reports/orderCommission.ts` — the entry identifies a user
- `~ server/services/commissionLedger.ts` — rates read from `users`
- `~ server/services/creditLedger.ts` — same
- `~ server/routes/orders.ts` — stamp the user, not the cashier profile
- `~ server/routes/cashiers.ts`, `~ server/routes/cashierAnalytics.ts` — payroll by user
- `+ server/__tests__/commissionByUser.test.ts`

**Steps:**

1. Add the user columns alongside the cashier ones rather than replacing them.
   Both are populated during the change so nothing reads a null mid-deploy.
2. Backfill each order's user from its shift's `opened_by_user_id` (G1). That is
   who was logged in when the shift ran, and it is the only honest answer
   available — record in the migration that it is an inference, not a record.
3. Make `cashier_shifts.cashier_id` nullable (G2) so a shift can exist for a user
   with no code at all.
4. Move the commission rate to the user. The old per-code rates cannot be mapped
   automatically, so the migration leaves `users.commission_rate` null and the
   org default applies until somebody sets them.
5. Keep `cashier_profiles` and its rows. Old Z-reports and payroll runs reference
   them, and deleting the table would rewrite history.

**Out of scope:** removing the open-shift modal — that is L2.

**DoD:**

- An order created by user A and completed by user B pays B 90% and A 10%.
- Commission is readable per user for a date range, with no cashier code involved.
- Every historic order has a user attributed, or is explicitly recorded as
  unattributable.
- Existing shift summaries are unchanged.

**Verification:** `npm test`; all five audit scripts; a payroll query by user
reconciling against the same figures by code before the change.

**PR title:** `feat(commission): attribute orders and commission to users`

---

## Brief L2 — A shift is a trading day, opened at login

**Goal:** Remove the open-shift step. A shift exists per user per trading day,
runs 06:00 to 06:00, and survives logging out and back in.

**Touch:**

- `+ migrations/058_shift_trading_day.sql` — `cashier_shifts.trading_day date`; unique on `(org_id, user_id, trading_day)`
- `+ server/services/tradingDay.ts` — the 06:00-to-06:00 window in org timezone
- `+ shared/reports/tradingDay.spec.ts`
- `~ server/middleware/requireActiveCashierShift.ts` — resolve or open the user's shift for today; never 409
- `~ server/middleware/requireOpenShift.ts` — retired or reduced to a no-op
- `- client/src/pages/pos/shift-open.tsx` — the modal goes
- `~ client/src/pages/pos.tsx`, `~ client/src/pages/pos/cashier-shift.tsx` — no open/close controls
- `~ server/services/cashierShiftEngine.ts` — day bucketing by trading day, not UTC date (G3); inactivity auto-close disabled (G4)

**Steps:**

1. The trading day for a timestamp is the date of the 06:00 boundary it falls
   after, computed in the org's timezone. 05:59 on the 12th belongs to the 11th.
2. Replace `utcDateKey` in the shift engine with the trading-day key. This is the
   one change most likely to move existing numbers, so it needs a test that pins
   an order at 05:59 and 06:01 either side of a boundary, and one that crosses a
   British Summer Time change.
3. Opening is lazy and idempotent: the first order-creating or order-completing
   action of a trading day opens that user's shift; everything after finds it.
   The unique index makes a double-open impossible.
4. Turn off inactivity auto-close (G4) rather than deleting the setting, so the
   column and its history survive.
5. Delete the open-shift modal and its cashier-code picker. The location it
   captured moves to the user's default location.

**Out of scope:** closing shifts — that is L3, and until it lands shifts simply
stay open.

**DoD:**

- Logging in and taking an order opens exactly one shift for that trading day.
- Logging out and back in returns to the same shift.
- Two users on at once have two shifts, both open, neither blocking the other.
- An order at 05:59 counts to the previous trading day; 06:01 to the new one.
- A boundary in British Summer Time is still 06:00 local.

**PR title:** `feat(shifts): a shift is a trading day, opened on first sale`

---

## Brief L3 — The 06:00 daily close

**Goal:** At 06:00 the system closes the previous trading day: totals it, closes
its shifts, and issues the Signals and reports.

**Touch:**

- `+ server/services/dailyClose.ts` — close the trading day for an org, idempotently
- `+ server/workers/dailyCloseTick.ts` — a periodic check in the existing loop (G7)
- `~ server/workers/index.ts` — register it
- `+ migrations/059_daily_close_runs.sql` — `daily_close_runs (org_id, trading_day, ran_at, ...)`, unique on `(org_id, trading_day)`
- `~ server/services/reportNotifications.ts` — the day's Signals
- `+ server/__tests__/dailyClose.test.ts`

**Steps:**

1. It is a check on the existing worker loop, not a cron: "is there an org whose
   06:00 has passed and whose previous trading day has not been closed?"
2. `daily_close_runs` with a unique key on `(org_id, trading_day)` makes it
   exactly-once. A server restarted at 06:00 must not total the day twice.
3. Closing a day closes every shift still open on it, producing each one's
   summary through the existing `closeCashierShift` path.
4. The Signals are the day's numbers and anything that needs attention — a
   variance, an unusual personal-use total, credit given out that day.
5. A day with no trading closes silently.

**DoD:**

- At 06:00 the previous day's shifts are closed and summarised.
- Running twice changes nothing the second time.
- A server down at 06:00 closes the day when it comes back, dated correctly.
- The Signals name the day they are about.

**PR title:** `feat(shifts): close the trading day at 06:00`

---

## Brief L4 — The Z-report so far

**Goal:** A cashier can see their shift's Z-report at any point during it,
without closing anything.

**Touch:**

- `~ server/routes/shifts.ts` — a live report for an open shift
- `~ client/src/pages/pos.tsx` — the button
- `~ client/src/components/ZReport.tsx` — an "in progress" state

**Steps:**

1. Reuse the existing Z-report builder. The only difference is that the shift is
   open, so counted cash and variance are not yet known and read as pending
   rather than zero — a zero variance on an uncounted drawer is a lie.
2. Label it as running, with the time it was taken.
3. Cashiers see their own; managers see any.

**DoD:** the running report matches the closed one for the same orders, bar the
drawer figures; no counted-cash figure is invented.

**PR title:** `feat(shifts): view your Z-report mid-shift`

---

## Brief L5 — Open Orders, redesigned

**Goal:** Make Open Orders good enough to work a counter from. It is where orders
are completed, so it is where commission is earned.

**Needs a specification before it is built** — "looking better" is not one. The
proposal to agree or reject:

- The list answers, at a glance: what is waiting, how long it has waited, and
  what is blocking it.
- Completing is one action from the list, not a drill-in.
- Who loaded each order is visible, since that decides where the 10% goes.
- Delay and ETA fields already on `orders` get surfaced rather than added to.
- Arcarna's own material and Truth Blue accent, per the design system.

**Out of scope until agreed:** anything that changes what an order *is*.

**PR title:** `feat(orders): rebuild the Open Orders counter view`

---

## Sequencing

| Brief | Depends on | Rough size |
|-------|-----------|-----------|
| L1 | K1–K7 | large — attribution changes hands |
| L2 | L1 | large — the trading-day rewrite touches every money bucket |
| L3 | L2 | medium |
| L4 | L2 | small |
| L5 | L2 | medium, once specified |

Answer question 1 before starting L1: the old per-code commission rates cannot be
carried over automatically, so somebody has to decide what each user's rate is.
