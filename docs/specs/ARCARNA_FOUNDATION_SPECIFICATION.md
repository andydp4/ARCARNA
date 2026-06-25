# ARCARNA™ Foundation Specification

> **Agent 0 — Foundation Architect.** This document is the **constitution** for every other
> specification and every future implementation decision. Where any other document conflicts with
> this one, this one wins.
>
> **Output rule (binding):** this document defines **global standards only**. It does **not** repeat
> route, component, or token detail — those live in the Route, Component, and Design System
> specifications. Global terminology is named here; per-surface copy is owned by the Language
> Specification.

---

## 0. Reading order and authority

1. **This document** — brand truth + global law.
2. [`ARCARNA_LANGUAGE_SPECIFICATION.md`](./ARCARNA_LANGUAGE_SPECIFICATION.md) — owns all words/terminology.
3. [`ARCARNA_DESIGN_SYSTEM_SPECIFICATION.md`](./ARCARNA_DESIGN_SYSTEM_SPECIFICATION.md) — owns tokens/surfaces/motion.
4. [`ARCARNA_COMPONENT_SPECIFICATION.md`](./ARCARNA_COMPONENT_SPECIFICATION.md) — owns component contracts.
5. [`ARCARNA_ROUTE_EXPERIENCE_SPECIFICATION.md`](./ARCARNA_ROUTE_EXPERIENCE_SPECIFICATION.md) — owns per-route experience.
6. [`ARCARNA_COMPLIANCE_REPORT.md`](./ARCARNA_COMPLIANCE_REPORT.md) — QA audit; gates implementation.

This experience constitution sits **beside** the engineering constitution
([`docs/ARCHITECTURAL_PRINCIPLES.md`](../ARCHITECTURAL_PRINCIPLES.md)), which remains authoritative for
server/schema/data integrity. A change must satisfy both.

---

## 1. Brand essence

**Arcarna™ — Reveal Your Truth™**

Arcarna helps **independent business owners see what they couldn't see before.**

Arcarna is not a point-of-sale toy and not a "finance-bro analytics dashboard". It is the
instrument an operator trusts to tell them the truth about their business and then show them what
to do about it. Every screen exists to convert data the owner already has into a truth they can act
on today.

**One-line essence:** *the instrument that reveals the truth of your business and points to the next move.*

---

## 2. Founder story

Arcarna began with a number that didn't add up.

A strong sales week — busy floor, good takings, the kind of week that feels like winning — ended
with only **£300** left in the business. The revenue had been real. The profit had not. That gap,
between *what came in* and *what was actually kept*, was the truth the numbers had been hiding in
plain sight.

The lesson is the product: **revenue and profit are not the same thing**, and most independent
owners are flying without an instrument that shows the difference. Arcarna exists to make that
truth — and every truth like it — impossible to miss, and easy to act on.

This story is the emotional core of the brand. Every feature should be able to trace back to it:
*does this help the owner see a truth they would otherwise have missed?*

---

## 3. Mission, vision, values

- **Mission.** Give independent business owners an instrument that reveals the truth of their
  business and guides their next move.
- **Vision.** Every independent operator runs on evidence, not guesswork — confident they can see
  what's really happening and what to do about it.
- **Values.**
  1. **Truth over flattery.** Show the real number, even when it's uncomfortable (the £300 week).
  2. **Clarity over cleverness.** Plain language and plain visuals beat dashboards that impress and don't inform.
  3. **Action over analysis.** A truth that doesn't lead to a next move is unfinished.
  4. **Calm over noise.** Signal, never alarmism. The instrument is steady.
  5. **Respect over hype.** The owner is expert in their business; Arcarna is their instrument, not their boss.

---

## 4. Brand promise

> **You will always know the truth of your business — and what to do next.**

Sub-promises that every surface must keep:

- **No blind spots.** If something matters, Arcarna surfaces it.
- **No dead ends.** Every truth resolves into an action the owner can take.
- **No spin.** The number on screen is the real number.

---

## 5. Emotional journey

The user arrives **curious** and leaves **empowered**. The arc, on every visit and within every route:

| Stage | User feeling | Arcarna's job |
|-------|--------------|---------------|
| **Arrive** | Curious / uncertain — "how are we actually doing?" | Greet with the day's truth, not a wall of widgets. |
| **See** | Recognition — "oh, *that's* what's happening." | Reveal the one truth that matters most, plainly. |
| **Understand** | Clarity — "I get why." | Explain the truth in one sentence, with evidence. |
| **Act** | Confidence — "I know what to do." | Offer the next move, in reach, here. |
| **Leave** | Empowered / in control | Confirm the action; close the loop. |

A surface that leaves the user impressed but not empowered has failed the journey.

---

## 6. Design principles (global)

> Detailed tokens/surfaces live in the Design System Specification. These are the global laws it
> must implement.

1. **Darkness is the canvas. Truth is the light. Understanding is the destination.** The interface
   is a dark, calm canvas; meaning is carried by light and a single truth-bearing accent.
2. **Colour is meaning, never decoration.** Every colour on screen encodes a state or a truth.
   Remove decorative chrome/metal/gradient effects that exist only to look expensive.
3. **One truth per view.** Lead with the single most important truth; everything else supports it.
4. **Calm, engineered, dependable.** Premium because it is precise and quiet, not because it shines.
5. **Evidence is visible.** Numbers are honest, aligned, and traceable to their source.

## 7. UX principles (global)

1. **Every route answers a question** (see §11).
2. **Mobile-first, one-handed, mid-shift.** Built for a tablet on a busy counter.
3. **No dead ends.** Every truth offers a next move; every empty state offers a first move.
4. **Speed is a feature.** Selling and searching are instant; nothing critical waits on a spinner.
5. **Progressive disclosure.** Reveal the truth first; let the owner drill into the evidence.
6. **Accessible by default.** WCAG 2.1 AA on operator-critical surfaces; state never by colour alone.

## 8. Writing principles (global)

> The Language Specification owns the vocabulary and per-surface copy. These are the global laws.

1. **Short, certain, useful.** One idea per sentence; lead with the verb or the number.
2. **State the truth, then the action.** Never hedge; never pad.
3. **Plain and spoken-friendly.** Every string should read well aloud (the assistant may speak it).
4. **Calm, practical, human, honest.** Never corporate, never alarmist, never hype.
5. **Second person.** "Your business", not "our platform".

---

## 9. AI personality

Arcarna's assistant is **Arcarna Voice** — a calm, plain-spoken operator's assistant.

- **It is rule-based and deterministic, not generative AI.** (Source: [`docs/ARCARNA_VOICE.md`](../ARCARNA_VOICE.md).)
  Never market it as "AI", "smart", "magic", or "a copilot" (see §14).
- **It tells the truth and confirms before acting.** It never creates a real order, refund, or
  charge without an explicit human "Yes."
- **It is brief and action-focused.** Responses are built to be spoken: one fact, one question, or
  one confirmation at a time.
- **Tone:** the same Arcarna voice — calm, practical, honest. It is an instrument that talks, not a
  personality that performs.

---

## 10. Global terminology

These are the **global names** for the product's core concepts. The Language Specification expands
each with exact copy; no other document may coin a competing term (see §15, governance).

| Concept (industry default) | Arcarna global term |
|----------------------------|---------------------|
| Dashboard / home | **Control Centre** |
| Insights | **Truths** |
| Reports | **Evidence** |
| Alerts / notifications | **Signals** |
| Recommendations | **Next Moves** |
| Analytics | **Intelligence** (only where "Truths/Evidence" don't fit) |
| The product | **ARCARNA EPOS** |
| The assistant | **Arcarna Voice** |

**Identity law.** `ARCARNA` (uppercase) in display; `arcarna` (lowercase) in URLs/slugs/keys.
Brand strings come only from [`shared/brand.ts`](../../shared/brand.ts); logos only from the supplied
assets in [`client/public/brand/`](../../client/public/brand/) — never redrawn.

---

## 11. The Question → Truth → Action framework

The spine of every route. A route is not complete until all three are named and present on screen.

1. **Question** — the business question the owner brings to this route ("Am I actually making money?").
2. **Truth** — the real fact the route reveals ("You kept £300 of £8,400 — a 3.6% margin.").
3. **Action** — the next move the truth demands ("Review your top 3 cost lines.").

The Route Specification records the Question/Truth/Action for every route. The £300 founder moment
is the canonical worked example: *Question:* did we have a good week? *Truth:* revenue ≠ profit.
*Action:* cut the costs eating the margin.

## 12. The Reveal → Explain → Guide framework

How each route *delivers* its Question → Truth → Action, and the order of the user's attention:

1. **Reveal** — surface the truth first, prominent and plain (the headline number/state).
2. **Explain** — one sentence of why, with visible evidence (the comparison, the breakdown).
3. **Guide** — the next move, in reach, as a clear action (button / signal / next move).

Reveal → Explain → Guide maps onto the emotional journey (§5: See → Understand → Act) and governs
visual hierarchy: the truth is the brightest thing on the canvas; the guidance is the clearest action.

---

## 13. Acceptance criteria (Foundation level)

A surface is Foundation-compliant when **all** hold:

- [ ] It names the **Question** it answers, reveals a **Truth**, and offers an **Action** (§11).
- [ ] It follows **Reveal → Explain → Guide** in its visual hierarchy (§12).
- [ ] It moves the user along the **emotional journey** to *empowered* (§5).
- [ ] It uses **only** `shared/brand.ts` for brand strings and official logo assets (§10).
- [ ] It uses the **global terminology** (§10) — no banned or legacy term.
- [ ] **Colour encodes meaning only** (§6.2); decorative chrome/metal removed.
- [ ] Copy obeys the **writing principles** (§8) and the **forbidden language** list (§14).
- [ ] It introduces **no duplicate term or component** (§15).

## 14. Forbidden language

- **Generic SaaS:** streamline, seamless, leverage, all-in-one, powerful (filler), robust,
  solutions, supercharge, unlock, effortless, game-changer, best-in-class, world-class, synergy.
- **AI hype:** AI-powered, AI-driven, powered by AI, magic, magical, smart (= clever), copilot, GPT.
- **Alarmism:** scare language in chrome; exclamation marks except where real urgency exists
  (destructive confirmations).
- **Legacy brand (Midnight):** any user-facing "Midnight" / "Midnight EPOS" / old logo variant
  names. *Exempt:* internal token names only (these are being retired by the Design System spec).

The Language Specification holds the complete, testable list and the grep gate.

## 15. Governance rules

1. **One concept, one term, one component.** No synonyms in chrome; no two components for one job.
   Duplicates are defects (the Component and Language specs maintain the ledgers).
2. **Terminology is added in the Language Specification first**, then used. A term in code but not
   in the glossary is a Compliance finding.
3. **Brand strategy is fixed.** No new tagline, mission, or positioning beyond §1–§4.
4. **No silent redesign of scope.** These specs evolve the *experience, language, and visual system*;
   they do not add, remove, or re-route product capabilities. IA changes require an explicit decision.
5. **QA gates implementation.** No code change ships against these specs until the Compliance Report
   passes (no contradiction, no duplication, no missing implementation detail, brand-compliant).
6. **Exceptions are explicit.** A deviation must be recorded in the PR with the principle waived and
   the approver — mirroring the engineering constitution's `Principle Exception` rule.
