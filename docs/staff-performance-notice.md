# Staff Performance: a notice for everyone who works here

**What this is.** arcarna now shows how the work of the shop is shared out.
It counts the jobs each person does on the till and the Operations board,
by the login you sign in with. It started recording on the day this notice
was issued. For the first two weeks every figure about a person is marked
**provisional** while the owner checks that the team totals are right.

**What it records about you.**

- The orders you **loaded** (keyed in), **prepared** (marked ready),
  **completed** (collected or delivered) and **dispatched** (sent out for
  delivery). Each job is counted on its own.
- The value of the orders you completed, and the **value brought in**, split
  the same way as commission: all of it when you did the order alone,
  otherwise 90% to whoever completed it and 10% to whoever loaded it.
- Quality: wrong-item refunds on orders you picked, your completions that
  were reopened, refunds you processed, orders you deleted, "unready" taps,
  and orders you completed that someone else had claimed.
- **Speed**: whether collections you marked ready and deliveries you sent out
  were on time, whether the first time promised was kept, how long each stage
  took, and how quickly you acknowledged your alerts. Sales handed over at the
  counter straight away are counted but not timed.
- **Benefit (£)** (managers and above only): the margin on your sales, less
  discounts, sales below cost and personal use. It is not profit.
- **Active hours**, from your daily shift: your first to your last action each
  day, plus 10 minutes, at most 12 hours. This is so part-timers are compared
  fairly, by rates per hour, per day and per 10 orders, not by totals.
- Which station you were on (Collection, Delivery, Both or All) when you
  acted on a card.
- Customer star ratings on orders you completed are shown to you for
  information only. They are never a target and never affect anything.

**What it does not record.** How long you spend on a screen, what you
click, or anything from outside your work in arcarna. Usage data about how
the app is used is never used for these figures.

**Who can see it.** You see your own figures on **My performance**, with a
team median only when 4 or more people worked (so no one's figure can be
worked out). Managers see cashiers' figures and their own. Admins and the
owner see everyone's. Customers are shown by name only. Nobody can see a
ranking of the whole team: there are **badges** anyone can earn instead, and
admin work is shown as one "Admin cover" line, never ranked.

**Targets.** Admins set targets for a few rates (for example, collections
ready on time). Each is green (met), amber (close), red (not met) or grey
(not enough data yet). For the first four weeks after targets are set
nothing shows red. Every change to a target is logged.

**Patterns.** Once a week the system looks for unusual weeks — for example,
three or more refunds and at least twice your usual. These go to the people
above you (a cashier's to managers and admins, a manager's to admins only)
as a question to look at, not an accusation. Most have a simple reason.

**The weekly digest.** After Monday's close you get a short summary of your
own week (managers also see cashiers', admins everyone's). It is built when
it is sent and not stored.

**What it is used for.** Seeing how the work is shared, spotting where
orders wait, recognising good work, and supporting people. **No pay decision
is made from these figures alone.** There is no bonus attached to them: the
old £50/£100/£150 bonus tiers have been removed, and pay will not be linked
to them for at least eight weeks. If that ever changes, you will be told
first, and you will have the right to have a person review any decision, to
give your side, and to challenge it.

**Your rights.** You can ask to see the figures held about you, ask for a
mistake to be corrected, and object. Speak to the owner.

---

## DPIA section: Staff Performance (v1.2 Phase 7A, 7B, 7C)

| | |
|---|---|
| **Processing** | Counts of order jobs, order values, refunds, deletes, reopens and station, per staff login, from records the till already keeps (`orders`, `order_events`, `refunds`). 7C adds, from existing records: line cost snapshots (for margin), discounts, price exceptions, personal use, credit payments and write-offs, customers created, personal alert acknowledgements (`ops_alerts`), and daily shift first/last action (`cashier_shifts`). New stored data: the actor's station on each board event (migration 170); targets as logged versions (`staff_targets`); who gave a satisfaction rating and from where (`satisfaction_scores.rated_by_user_id`, `source`); a weekly run row with counts only (`staff_weekly_runs`); loss-prevention flags in Needs a look (`exception_reviews`, kind `pattern`). |
| **Purpose** | Understanding workload and service speed; supporting and recognising staff; loss prevention. |
| **Lawful basis** | Legitimate interests (UK GDPR Art. 6(1)(f)): running the shop fairly and safely. Balancing test: the data is already created by doing the job; views are limited by role; no ranking is published; flags are neutral questions routed only upwards. |
| **Data minimisation** | No screen-time, keystroke or usage data (Phase 8 data is excluded by design). Customers appear by name only. No cost or margin reaches cashiers (My performance carries none). The weekly digest is built per recipient at send time and never stored with names and figures. |
| **Access** | Server-enforced (`shared/accessPolicy.ts`): managers see cashiers and themselves; admins and the owner see everyone; cashiers see only their own figures (My performance), with a team median only at 4+ people. Targets: everyone reads, admins only write. Flags follow Needs a look: cashiers' to managers and admins, managers' to admins only, never the person themselves. Pages are sent with `Cache-Control: no-store` and are not kept by the app's service worker. |
| **Accuracy** | The team rows are tested to add up to gross settled sales (`server/__tests__/staffPerformance.test.ts`). 7C maths is unit-tested (`shared/reports/staffPeople.spec.ts`) and tested against a real database (`server/__tests__/staffPerformance7c.test.ts`). Figures per person are labelled provisional for 14 days after go-live; today's figures are always labelled provisional; targets are amber-only for their first four weeks. Satisfaction duplicates were removed before the one-rating-per-order rule. |
| **Loss-prevention rule** | A flag needs 3+ events in the week AND at least twice the person's own 8-week baseline (weeks they worked), OR a place in the top 5% of all person-weeks in the window (only with 20+ to compare). Wording states what was counted and what is usual, never intent. |
| **Automated decisions** | None. No pay, discipline or rota decision is made by the figures alone. Should one ever be, the UK GDPR Article 22 safeguards as amended by the Data (Use and Access) Act 2025 (in force 5 February 2026) apply: tell the person, allow them to make representations, give human intervention, and allow a challenge. |
| **Retention** | As the order records they come from. Targets and flags are kept with the org's other audit records. |
| **Risks and mitigations** | Unfair comparison of part-timers: jobs counted separately, rates per active hour/day/10 orders, only rates coloured. Peer visibility: no public ranking, badges instead, medians only at 4+. Misreading early data: provisional labels, amber-only first weeks, grey when too little data. False suspicion from flags: neutral wording, baseline and minimum-event rule, routed only upwards, reviewed by a person. |
| **Review** | After the first two weeks, four weeks after targets are first set, and before any link to pay is considered. |
