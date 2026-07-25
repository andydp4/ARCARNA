# Neon Database Cost Review & Recommendations

**Prepared:** 23 July 2026
**Scope:** Why ARCARNA's Neon database keeps hitting its usage limit while the system
sits idle, what it will cost as real businesses come on board, and whether Neon is
still the right database for the programme.

> **Currency note.** Neon bills in **US dollars**. GBP figures below are approximate
> at roughly **£1 ≈ $1.27** (so $1 ≈ £0.79). Treat £ as a guide, $ as the real number.

---

## 1. Executive summary

- **The idle cost is a bug, not normal behaviour.** The app was polling the database
  ~15–16 times **every second, 24/7**, even with zero orders. Neon is a *serverless*
  database that is supposed to **"scale to zero"** (suspend and stop billing) when idle.
  The constant polling meant it **never suspended**, so you paid for compute **around the
  clock** — roughly **$19/month (~£15) doing absolutely nothing**, plus it burned through
  the Free tier's allowance in about two weeks, which is what forced the upgrade. This is
  consistent with the ~£25 across "two tiers" you saw.
- **It is now fixed** (this change). The background workers were rewritten to go quiet
  when there is no work and wake instantly when an order arrives. Idle cost should drop
  from ~£15/month to roughly **£1–2/month** (and lower with the console setting below).
- **Projected running cost after the fix:**
  - 1 business, 10–20 orders/day → **~$8–12/month (~£6–10)**
  - 3 businesses, 100 orders/day each → **~$15–30/month (~£12–24)**, all on one database.
- **Is Neon still right?** For a shop that's only busy a few hours a day, Neon's
  pay-for-what-you-use model is actually a *good* fit — **once it's allowed to suspend**,
  which is exactly what was broken. Keep it for now (fix + spend cap). If squeezing cost
  to the absolute minimum matters more than convenience, the app can also run its database
  **on the Hostinger VPS you already pay for** at near-zero extra cost — the code already
  supports this. See §5.

---

## 2. What was causing usage while the system sat idle

### 2.1 How Neon charges (the important bit)

Neon does **not** charge per query. It charges for **compute-hours**: the size of the
compute (in "CU" — 1 CU = 1 vCPU + 4 GB RAM) multiplied by **how long the compute is
switched on**. When nothing queries the database, Neon **suspends** the compute after an
idle timeout (default **5 minutes**) and stops charging — this is "scale to zero".

**The trap:** *any* query resets that idle timer. So a background job that runs even once
a minute keeps the compute permanently awake, and you are billed 24/7 as if the system
were busy — regardless of how few orders you actually take.

### 2.2 What the code was doing

The server ran several fixed-rate timers that hit the database whether or not there was
any work to do:

| Source | Interval | Idle DB queries |
|---|---|---|
| Worker job poller (`server/workers/index.ts`) | every **200 ms × 3 in parallel** | ~15 / second |
| Event dispatcher | every **1 s** | ~1 / second |
| Scheduled-reports timer | every **60 s** | 1 / minute |
| RFM "nightly" timer | every **60 s** | 1 / minute |
| Cashier-shift auto-close timer | every **60 s** | 1 / minute |
| Reconciliation safety-net | every **5 min** | continual |
| Session-store prune (`connect-pg-simple`) | every **~15 min** (library default) | continual |

Net effect: **~16 database queries per second, forever**, most of them finding *nothing to
do*. That is ~1.4 million pointless queries a day. Because something touched the database
far more often than every 5 minutes, **Neon could never suspend** → you paid for a full
month of always-on compute even at zero orders.

At the minimum compute size (0.25 CU), always-on works out to:

```
0.25 CU × 730 hours/month × $0.106 per CU-hour ≈ $19.3/month (~£15)  — purely idle
```

On the **Free** tier (≈100 compute-hours/month) the same always-on compute burns the
whole monthly allowance in **~16 days** (0.25 CU × 24 h = 6 CU-hours/day), which is what
pushed the project onto a paid plan in the first place.

### 2.3 The fix (in this change)

The background processing was rewritten from "poll constantly" to **"sleep until there's
work"**:

- **Idle-aware worker loop.** Instead of fixed timers, the runner now self-schedules with
  exponential back-off: it polls fast (250 ms) while draining jobs, then backs off to a
  long idle ceiling (**15 min**, configurable) and stops touching the database. When truly
  idle it makes only a handful of queries per hour, so **Neon can finally suspend**.
- **Instant wake on activity.** When an order (or any event) is written, `publishEvent`
  nudges the loop awake immediately, so jobs are still processed within ~1 second. No
  latency regression for real work.
- **Precise retry scheduling.** Failed jobs (which retry with back-off up to 15 min) are
  now woken *exactly* when due via a single look-ahead query, instead of being found by
  constant polling.
- **The 60-second service timers and the 5-minute reconciliation were folded into one
  coarse "housekeeping" pass** on the same loop (default every 15 min), removing four
  independent always-on timers.
- **Session pruning** (`connect-pg-simple`) changed from every ~15 min to **every 6 hours**
  (configurable), so expired-session cleanup no longer keeps the compute awake.

**Files changed:** `server/workers/index.ts`, `server/workers/wakeSignal.ts` (new),
`server/eventBus.ts`, `server/index.ts`, `server/replitAuth.ts`, `.env.production.example`,
plus a unit test `server/__tests__/wakeSignal.test.ts`. TypeScript check and the full test
suite pass.

### 2.4 Two console/config steps to finish the job (no code)

The code change lets Neon suspend; these two settings make idle cost as low as it goes:

1. **Set Neon "Scale to zero" to 60 seconds.** Neon Console → your Branch → Compute →
   Edit → set the suspend timeout to **1 minute** (default is 5). This cuts the "tail"
   after each burst of activity by 5×.
2. **Set a spend cap / budget alert** on the Neon project so a future runaway can't
   silently accrue charges again.

Optional: raise `WORKER_IDLE_CEILING_MS` from 15 min to 30 min (in `.env`) to halve idle
wake-ups further.

**Expected idle cost after fix + 60 s suspend:** roughly **$1–2/month (~£1–2)**, versus
~£15/month before.

---

## 3. Cost projections

**Key principle:** at these volumes the cost is driven almost entirely by **how many hours
per day the database is *awake*** — not by the order count. A few hundred orders a day is
trivial for Postgres and keeps the compute at its minimum 0.25 CU size. What keeps the
compute awake is staff having the app open (the browser auto-refreshes a few times a
minute, which queries the API → database) plus the short bursts around each sale.

Assumptions: Launch plan at **$0.106/CU-hour** compute and **$0.35/GB-month** storage;
compute suspends overnight/when closed; minimum size 0.25 CU with brief 0.5 CU under load.

### Scenario A — 1 business, 10–20 orders/day

| Item | Estimate |
|---|---|
| Hours DB awake | ~10 h/day (open hours) × 30 = ~300 h/month |
| Compute | ~0.25 CU × 300 h ≈ 75 CU-h → **~$8/month** |
| Storage | <1 GB → **<$0.35/month** |
| **Total** | **≈ $8–12/month (~£6–10)** |

If terminals are closed/locked when not serving (so the DB suspends between customers
rather than staying awake all day), this drops toward **$3–5/month**.

### Scenario B — 3 businesses, 100 orders/day each (one shared database)

| Item | Estimate |
|---|---|
| Orders | 300/day ≈ 20–30/hour combined — still light for Postgres |
| Hours DB awake | ~12–14 h/day (overlapping open hours) |
| Compute | ~0.35 CU avg × ~390 h ≈ 137 CU-h → **~$14.5/month** |
| Storage | ~108k orders/year + items + analytics ≈ 0.5–1.5 GB/yr → **<$0.5/month**, growing slowly |
| **Total** | **≈ $15–30/month (~£12–24)** for all three combined |

### ⚠️ The one thing that breaks these projections

If a till/terminal is left **switched on with the app open and the screen awake 24/7**, the
browser keeps polling and **Neon never suspends** — putting you right back to ~$19–38/month
per always-on compute *regardless of order count*. This is the same trap as the original
bug, just driven by the front end instead of the back end. Mitigations:

- Let terminals **sleep/lock** when idle (the app already stops polling when its browser
  tab is hidden/backgrounded — React Query default).
- The orders screen currently refreshes **every 10 seconds** (`client/src/pages/orders.tsx`)
  — the most aggressive poller. Relaxing this to 30–60 s is a safe, easy follow-up that
  reduces awake-time pressure with no meaningful UX loss.

---

## 4. Is Neon the right product vs the cost?

**Short answer: yes for now — the problem was never Neon's pricing, it was the app
defeating Neon's scale-to-zero.** With that fixed, Neon is a sensible, low-effort choice at
these volumes. But if minimum cost is the top priority, there's a cheaper option you're
already set up for (self-hosting on the VPS). Here's the honest comparison.

| Option | Est. monthly cost @ projected volumes | Pros | Cons |
|---|---|---|---|
| **Neon, after this fix** *(recommended default)* | Idle ~£1–2; running **~£6–24** | No DB to run/patch; scale-to-zero; dev branching; backup-to-R2 scripts already exist; **no migration needed** | ~0.5–2 s cold-start on the first query after a quiet spell; usage-based bills need a spend cap |
| **Self-host Postgres on the Hostinger VPS** *(cheapest)* | **~£0 extra** (uses the VPS you already pay for) | Lowest, fully predictable cost; no per-use billing; no cold starts; `docker-compose.yml` + `DB_DRIVER=node-postgres` + backup/restore scripts **already in the repo** | You own backups, patching, uptime; single point of failure; no branching |
| **Supabase Pro** | ~$25/month (~£20) flat | Predictable flat fee; bundles auth + storage | No scale-to-zero savings; you already use **Clerk** for auth, so the bundle adds little; pricier than the two above at this scale |
| **Other managed Postgres (RDS, DO, etc.)** | ≥ Supabase, typically more | Mature tooling | More expensive and more ops than the options above; no advantage here |

**Why Neon fits this workload.** A single small shop (or three) is busy for a slice of the
day and idle the rest. A traditional always-on database charges you 24/7 for capacity you
use a few hours a day; Neon's scale-to-zero is designed precisely to *not* do that. The
original recommendation to use Neon was sound — it was simply undermined by the polling bug.

**When to switch to the VPS option.** If, after the fix and the 60 s suspend setting, you
still want the cost floor to be effectively zero and you're comfortable the DB living on the
same box as the app (with the existing nightly backup to Cloudflare R2), moving Postgres onto
the VPS is a low-risk, well-supported path — the code already runs both ways. The trade-off
is that you take on backups/patching/uptime yourself.

---

## 5. Recommendations

**Do now (this week):**

1. **Ship this fix** (branch `claude/neon-database-cost-review-gacp5x`) and redeploy. This is
   the single biggest lever — it takes idle from ~£15/month toward ~£1–2/month with no change
   to how the app behaves for users.
2. **Set Neon "Scale to zero" to 60 seconds** and **set a spend cap / budget alert** on the
   Neon project (Console settings). No code required.

**Do soon (low effort, further savings):**

3. **Relax the orders-screen auto-refresh** from 10 s to 30–60 s, and make sure tills
   sleep/lock when idle, so an open app doesn't hold the database awake all day.

**Decide (steady-state cost strategy):**

4. **Stay on Neon** if you value zero database maintenance and are happy with ~£6–24/month at
   the projected volumes — the recommended default. **Or move Postgres onto the Hostinger VPS**
   (already supported: `docker-compose.yml`, `DB_DRIVER=node-postgres`, backup/restore scripts)
   if you want the cost floor at ~£0 and accept owning backups/uptime yourself.

**Verify the fix worked:**

5. After deploying, watch the Neon Console's **compute-hours graph** for a full day. You should
   see the compute **suspend** during quiet periods (flat/zero) instead of a solid 24/7 line —
   that's the proof the idle billing is gone.

---

## 6. Sources

Neon pricing referenced from public 2026 pricing summaries (Neon bills in USD; verify current
figures in your Neon Console → Billing):

- Neon plans & pricing — https://neon.com/pricing and https://neon.com/docs/introduction/plans
- Scale-to-zero configuration (default 300 s; configurable to 60 s) —
  https://neon.com/docs/guides/scale-to-zero-guide
- Independent 2026 pricing breakdown —
  https://vela.simplyblock.io/articles/neon-serverless-postgres-pricing-2026/
- Community note on light traffic preventing suspend (the exact failure mode here) —
  https://github.com/neondatabase/neon/discussions/12900
