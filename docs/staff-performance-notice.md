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
- Which station you were on (Collection, Delivery, Both or All) when you
  acted on a card.

**What it does not record.** How long you spend on a screen, what you
click, or anything from outside your work in arcarna. Usage data about how
the app is used is never used for these figures.

**Who can see it.** Managers see cashiers' figures and their own. Admins
and the owner see everyone's. Customers are shown by name only. Nobody can
see a ranking of the whole team; admin work is shown as one "Admin cover"
line and never ranked.

**What it is used for.** Seeing how the work is shared, spotting where
orders wait, and supporting people. **No pay decision is made from these
figures alone.** There is no bonus attached to them. If that ever changes,
you will be told first, and you will have the right to have a person review
any decision, to give your side, and to challenge it.

**Your rights.** You can ask to see the figures held about you, ask for a
mistake to be corrected, and object. Speak to the owner.

---

## DPIA section: Staff Performance (v1.2 Phase 7A/7B)

| | |
|---|---|
| **Processing** | Counts of order jobs, order values, refunds, deletes, reopens and station, per staff login, from records the till already keeps (`orders`, `order_events`, `refunds`). New: the actor's station on each board event (migration 170). |
| **Purpose** | Understanding workload and service speed; supporting staff; loss prevention (7C). |
| **Lawful basis** | Legitimate interests (UK GDPR Art. 6(1)(f)): running the shop fairly and safely. Balancing test: the data is already created by doing the job; views are limited by role; no ranking is published. |
| **Data minimisation** | No screen-time, keystroke or usage data (Phase 8 data is excluded by design). Customers appear by name only. No cost prices reach cashiers. |
| **Access** | Server-enforced (`shared/accessPolicy.ts`): managers see cashiers and themselves; admins and the owner see everyone; cashiers see only their own figures (My performance, 7C). Pages are sent with `Cache-Control: no-store`. Exports are admin only and logged. |
| **Accuracy** | The team rows are tested to add up to gross settled sales (`server/__tests__/staffPerformance.test.ts`). Figures per person are labelled provisional for 14 days after go-live. |
| **Automated decisions** | None. No pay, discipline or rota decision is made by the figures alone. Should one ever be, the UK GDPR Article 22 safeguards as amended by the Data (Use and Access) Act 2025 (in force 5 February 2026) apply: tell the person, allow them to make representations, give human intervention, and allow a challenge. |
| **Retention** | As the order records they come from; nothing new is stored except the station on each event. |
| **Risks and mitigations** | Unfair comparison of part-timers: jobs are counted separately and rates per hour come in 7C. Peer visibility: no public ranking. Misreading early data: provisional label. |
| **Review** | After the first two weeks, and when 7C (targets and flags) goes live. |
