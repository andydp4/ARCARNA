# Faking time in tests

How this codebase controls "now", and — more importantly — where it must not try to.

Written for the Operations Centre (Phase N), whose whole subject is elapsed time: cards that go
amber then red, promises that fall due, alerts that fire ten minutes before a collection. Almost
every test in that phase has an opinion about what time it is, and the wrong way to express that
opinion is cheap to write and expensive to debug. This page is the convention; it applies to
anything time-dependent, not only to the board.

Read it before writing a test that contains the words "wait", "late", "due" or "clock".

---

## The rule in one line

**Pure functions take `now` as an argument. Fake clocks are for code that owns a timer. The
server's clock is real and cannot be moved from a test.**

Everything below is why.

---

## 1. Pure functions take `now` — they never read it

This is not new. It is already how the codebase works, in every layer:

| Function | Signature | Where |
|---|---|---|
| `describeWait` | `describeWait(createdAt, now = Date.now())` | [`client/src/components/orders-row.tsx:59`](../../client/src/components/orders-row.tsx) |
| `deriveCardState` | `deriveCardState(order, now, settings)` | [`shared/orders/opsState.ts:152`](../../shared/orders/opsState.ts) |
| `resolveShiftForToday` | `resolveShiftForToday(orgId, userId, now = new Date())` | [`server/services/tradingDayShift.ts:24`](../../server/services/tradingDayShift.ts) |
| `runDueDailyCloses` | `runDueDailyCloses(now = new Date())` | [`server/services/dailyClose.ts:310`](../../server/services/dailyClose.ts) |
| `currentTradingDay` | `currentTradingDay(timeZone, now = new Date())` | [`shared/time/tradingDay.ts:139`](../../shared/time/tradingDay.ts) |
| `resolveOrderDating` | `resolveOrderDating(orgId, orderDate, now = new Date())` | [`server/services/orderDating.ts:40`](../../server/services/orderDating.ts) |

Not one of them calls `Date.now()` or `new Date()` internally to decide anything. The default
parameter is a convenience for production callers; the parameter itself is what makes the function
testable.

**Any new pure logic in this phase follows the same rule.** `deriveCardState` says so in its own
header comment, and it is the reason its spec can assert every one of the ten card states at its
boundary ±1 second without a single timer:

```ts
const now = new Date("2026-09-12T14:30:00.000Z");
expect(deriveCardState(order, new Date(now.getTime() - 1_000), settings).state).toBe("due-soon");
expect(deriveCardState(order, new Date(now.getTime() + 1_000), settings).state).toBe("late");
```

A test written that way is exact, instant, and cannot flake. A test that faked the global clock to
achieve the same thing would be slower, would leak into neighbouring tests, and would prove less.

**So: never reach for `vi.useFakeTimers()` to test a function you can simply hand a `now` to.**
If a function is awkward to test without a fake clock, that is usually the function telling you it
should take `now` — change the signature, not the test.

---

## 2. `vi.useFakeTimers()` is for code that owns a timer

There is one honest use: a hook, component or scheduler whose behaviour **is** its own
`setInterval` / `setTimeout`. Ticking is the thing under test, so the timer has to be controllable.

In this phase that is `client/src/lib/opsClock.ts` and its ticker hook — the countdown that repaints
a card's big clock every second — tested in `client/src/lib/__tests__/opsClock.test.ts`. The test
matrix in the brief names that file and no other for a reason: it is the only place where advancing
a fake timer is testing the code rather than working around it.

When you do use it:

```ts
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());  // never optional — leaked fake timers hang the next file
```

Do **not**:

- use it as a blanket `beforeEach` for a whole file "just in case";
- use it to test a pure function (see §1);
- use it in a test that also awaits a network call or a database query — a fake clock and a real
  I/O timeout are a deadlock waiting to be scheduled.

---

## 3. Server-side time is real. `page.clock` cannot move it

**This is the correction that matters most, and the one an adversarial review of an earlier draft of
the Phase N spec caught.**

Playwright's `page.clock` fakes the clock **inside the browser page**. That is all it does. It has no
reach into the Node process serving the request.

Now consider what actually produces a "late" or "due soon" alert. `sweepOpsAlerts(now)` runs in the
server's worker runner, on the server's own wall clock, and inserts `ops_alerts` rows. The board
endpoint returns the rows that exist. So:

> Fast-forwarding the browser's clock by ten minutes cannot make a server-side alert row appear one
> millisecond sooner. The page will happily render "DUE SOON" from its own ticker while the alert
> rail stays empty, and a test asserting on the rail will time out for reasons that look nothing
> like the cause.

### The correct pattern: seed a real promise a few real minutes ahead

Make the server's real clock reach the moment you care about, by putting the moment close to now:

```ts
import { db } from "../../server/db";
import { orderInState } from "./opsFixtures";

// A promise nine real minutes away, with a ten-minute due-soon lead: the sweep
// has something to find on its very next pass.
const order = await orderInState(api, db, "due-soon", { dueIn: 9 });

await expect
  .poll(async () => (await okJson<Board>(await api.get("/api/orders/board"))).alerts.length, {
    timeout: 25_000,
  })
  .toBeGreaterThan(0);
```

`tests/journeys/opsFixtures.ts` exists for exactly this: `orderInState` places a real order through
the real API and then sets the fields no endpoint can set yet with a direct drizzle write from the
test runner — the same technique `tests/journeys/security/tenants.ts` already uses to create org B
and its second location. Writing a timestamp from the runner is legitimate; it is *seeding a fact*,
not faking a clock.

### Why the poll window is ~20–30 seconds and not 2

Three real latencies stack up, and the window has to clear all three:

1. the worker runner's wake — the sweep runs on active ticks, not continuously;
2. the board's reconciliation poll / stream delivery;
3. ordinary request and render time.

The brief settles on **25 seconds** for alert journeys. Use `expect.poll` (or `expect(...).toPass()`)
so a fast machine finishes in a second and a loaded CI box still passes; never a bare
`page.waitForTimeout(25_000)`, which is both slower and less informative when it fails.

### Do not compensate by shortening the server's schedule

Setting the due-soon lead to five seconds to "make the test quick" tests a configuration nobody runs.
Keep the real defaults and move the promise instead.

---

## 4. Where `page.clock` IS right — and how to stop it lying

`page.clock` is the right tool for **client-side rendering that is purely a function of the clock**:
the countdown text, the chip flipping from ON TIME to DUE SOON, the colour band changing. Those are
`deriveCardState` and the ticker running in the browser over data the browser already has.

One condition, and it is not optional:

> **Hold the board response constant while the clock moves.**

Otherwise a reconciliation poll lands mid-test, the client re-syncs its clock to `serverNow`, and the
fast-forward is silently undone — or worse, the assertion passes because a *real* server change
arrived, and the test proves nothing about the ticker at all.

```ts
// Pin the payload: every board request answers with the same bytes.
await page.route("**/api/orders/board", (route) => route.fulfill({ json: boardPayload }));
await page.clock.install({ time: new Date("2026-09-12T14:20:00Z") });
await page.goto("/operations");

await expect(page.getByTestId(`ops-card-${id}`)).toHaveAttribute("data-state", "on-time");
await page.clock.fastForward("00:11");           // past the due-soon lead
await expect(page.getByTestId(`ops-card-${id}`)).toHaveAttribute("data-state", "due-soon");
```

Rules of thumb:

- `page.clock` + `page.route` on the board endpoint: fine, and the only supported combination.
- `page.clock` with a live server: not supported. If an assertion depends on anything the server
  decided, §3 applies instead.
- Never mix the two in one test. Decide whether the subject is the browser's renderer or the
  server's scheduler, and write the test for that one.

---

## 5. Timezones: use the helpers, do not re-derive them

The trading day runs 06:00 → 06:00 in the org's own timezone, and `shared/time/tradingDay.ts` owns
that rule: `localInstant`, `localInstantAt` (minute-granular, added in N0 for `dueTime`),
`currentTradingDay`, `tradingDayBounds`, `lastClosedTradingDay`. They are pure, they take the
timezone explicitly, and they have their own spec covering the BST/GMT boundaries.

Therefore:

- **Do not re-test timezone arithmetic inside a journey.** It is already proven at the unit level,
  and a browser test that fails on a BST boundary tells you almost nothing about where the bug is.
- **Do not invent a second conversion** in a fixture or a spec — no hand-rolled `+1 hour`, no
  `new Date(y, m, d)` relying on the runner's local zone, no `toISOString().slice(0, 10)` to get "a
  date in London" (that is UTC, and wrong for part of every day).
- Either call the helpers, or pass an explicit ISO instant and be done.

`opsFixtures.ts` follows this: it reads the org's real `timezone` column rather than assuming one,
and formats calendar dates with `Intl.DateTimeFormat(… { timeZone })` purely as *formatting* — every
actual rule still comes from `tradingDay.ts`.

---

## 6. Quick reference

| You want to test | Use | Never |
|---|---|---|
| A pure rule at a boundary (`deriveCardState`, timing maths, chime policy) | Pass `now` explicitly | `vi.useFakeTimers`, real waiting |
| A ticker / interval / scheduler that owns its own timer | `vi.useFakeTimers()` + `vi.useRealTimers()` in `afterEach` | Leaving fake timers installed |
| A label or countdown re-rendering in the browser | `page.clock` **with** `page.route` holding the board response | `page.clock` against a live server |
| A server-side alert, lateness or sweep | A real promise a few real minutes out (`orderInState(…, { dueIn: 9 })`) + `expect.poll` within ~25 s | `page.clock`, `waitForTimeout`, shortening the org's lead |
| Anything crossing 06:00 or a DST change | `shared/time/tradingDay.ts` helpers, unit-tested | A second conversion written in the test |

---

## Related

- [`docs/briefs/PHASE_N_OPERATIONS_CENTRE.md`](../briefs/PHASE_N_OPERATIONS_CENTRE.md) — § *Test
  matrix* names the file each rule belongs to; § *Alerts & notifications* explains the sweep this
  page keeps tests honest about.
- [`tests/journeys/opsFixtures.ts`](../../tests/journeys/opsFixtures.ts) — `orderInState`,
  `secondCashier`, `headersFor`.
- [`tests/journeys/security/tenants.ts`](../../tests/journeys/security/tenants.ts) — the precedent
  for writing facts to the database directly from the Playwright runner.
