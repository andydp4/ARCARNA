# ARCARNA™ Language Specification

> **Agent 3 — Language Architect.** Subordinate to
> [`ARCARNA_FOUNDATION_SPECIFICATION.md`](./ARCARNA_FOUNDATION_SPECIFICATION.md). **Owns every
> user-facing word** and the banned-words gate. No other document may coin a competing term
> (Foundation §15).
>
> **Voice:** calm, practical, human, honest. Never corporate. Never alarmist. Never hype.
>
> **Note on current code:** today's navigation/labels still use industry-default terms
> ("Dashboard", "Business Insights") in [`client/src/components/nav-items.ts`](../../client/src/components/nav-items.ts).
> This spec defines the **approved target**; the gap is recorded in the Compliance Report.

---

## 1. Approved vocabulary (global renames)

| Industry default | **Arcarna approved term** | Notes |
|------------------|---------------------------|-------|
| Dashboard / Home | **Control Centre** | The day's truth at a glance. |
| Insights | **Truths** | A truth is a real, named fact about the business. |
| Reports | **Evidence** | Evidence backs a truth; it is exportable/scheduled. |
| Alerts / Notifications | **Signals** | A signal is a truth that needs attention now. |
| Recommendations | **Next Moves** | The action a truth demands. |
| Analytics | **Intelligence** | Use **only** where Truths/Evidence don't fit (e.g. cross-cutting analysis views). |
| Point of sale | **Create Order** | The selling screen. |

These map to the navigation groups (Foundation/Route): **Control Centre · Sell · Stock ·
Understand · Operate · Administer**.

## 2. Forbidden vocabulary (testable)

Fails review; grep gate in §18.

- **Generic SaaS (Foundation N3):** streamline, seamless(ly), leverage, all-in-one, one-stop,
  powerful (filler), robust, solutions (as "business solutions"), supercharge, unlock, effortless,
  game-changer, best-in-class, cutting-edge, world-class, synergy, take it to the next level.
- **AI hype (Foundation N4):** AI-powered, AI-driven, powered by AI, magic(al), smart (= clever),
  intelligent automation, copilot, GPT, "let AI do the work".
- **Alarmism:** "urgent!", "warning!" in chrome; gratuitous exclamation marks. (Signals are calm.)
- **Midnight residue (Foundation N5):** Midnight, Midnight EPOS, white-on-navy, navy-on-white.
  *Exempt:* internal token names `liquid-metal`/`lm-*` (being retired by the Design System spec).
- **Decoration/vagueness:** amazing, awesome, delightful, beautiful (in product copy), simply,
  just (filler), etc.

## 3. Navigation language (approved labels by group)

Source of truth for nav copy. Replaces the current `nav-items.ts` labels (remediation item).

| Group | Route | Current label | **Approved label** |
|-------|-------|---------------|--------------------|
| **Control Centre** | `/` | Dashboard | **Control Centre** |
| **Sell** | `/create-order` | Create Order | **Create Order** |
| Sell | `/open-orders` | Open Orders | **Open Orders** |
| Sell | `/shifts` | Shifts | **Shifts** |
| Sell | `/invoices` | Invoices | **Invoices** |
| Sell | `/tick-list` | Tick List | **Tick List** |
| **Stock** | `/products` | Products | **Products** |
| Stock | `/inventory` | Inventory | **Inventory** |
| Stock | `/purchase-drafts` | Purchase Drafts | **Purchase Drafts** |
| **Understand** | `/insights` | Business Insights | **Truths** |
| Understand | `/analytics/rfm` | RFM Segments | **Customer Segments** (RFM) |
| Understand | `/analytics/hour-of-day` | Hour of day | **Busiest Hours** |
| Understand | `/analytics/channels` | Channels | **Order Channels** |
| Understand | `/analytics/stock-turn` | Stock turn | **Stock Turn** |
| Understand | `/expense-reports` | Profit Analysis | **Profit Analysis** |
| Understand | `/scheduled-reports` | Scheduled reports | **Scheduled Evidence** |
| **Operate** | `/customers` | Customers | **Customers** |
| Operate | `/loyalty` | Loyalty | **Loyalty** |
| Operate | `/promotions` | Promotions | **Promotions** |
| Operate | `/gift-cards` | Gift cards | **Gift Cards** |
| Operate | `/locations` | Locations | **Locations** |
| Operate | `/expenses` | Expenses | **Expenses** |
| **Administer** | `/settings` | Settings | **Settings** |
| Administer | `/user-access` | User Access | **User Access** |
| Administer | `/settings/developer` | Developer | **Developer** |
| Administer | `/audit-logs` | — | **Audit Log** |
| Administer | `/worker-logs` | — | **System Activity** |
| Administer | `/rules` | — | **Rules** |

The Notification Center is **Signals**. Recommendation surfaces are **Next Moves**.

## 4. Page titles

- The page `<h1>` **equals the approved nav label**, exactly (e.g. "Control Centre", "Truths").
- One H1 per route. No brand prefix in the title (the shell already carries `ARCARNA EPOS`).
- Title Case for the approved surface names; never restyle them in body copy.

## 5. Subtitles / questions (the route's question)

Every in-app page header carries a one-line **subtitle = the business question the route answers**
(Foundation §11). Present tense, plain, no full stop required.

| Route | Approved subtitle (question) |
|-------|------------------------------|
| `/` Control Centre | "How is your business doing today?" |
| `/create-order` | "What is this customer buying?" |
| `/open-orders` | "What still needs finishing?" |
| `/shifts` | "Who was on, and did the till balance?" |
| `/products` | "What you sell — and is it set up right?" |
| `/inventory` | "What's in stock, and what's running out?" |
| `/customers` | "Who buys from you, and what are they worth?" |
| `/loyalty` | "Who are your best customers — and are they rewarded?" |
| `/promotions` | "What's on offer, and is it working?" |
| `/insights` Truths | "What should you know about your business right now?" |
| `/expense-reports` Profit Analysis | "Are you actually making money?" |
| `/expenses` | "Where is your money going?" |
| `/invoices` | "Who owes you, and is it paid?" |
| `/tick-list` | "Who's buying on tick, and what's outstanding?" |
| `/purchase-drafts` | "What do you need to reorder?" |
| `/locations` | "How is each location performing?" |
| `/user-access` | "Who can do what in your business?" |
| `/settings` | "How Arcarna is set up for your business" |

## 6. Button language

- **Verb + noun.** "Create order", "Add product", "Open shift", "Issue refund", "Export evidence".
- Sentence case. No trailing punctuation. No bare "Submit"/"OK" where a real verb fits.
- **Next Moves** are buttons phrased as the action: "Review your top 3 costs", "Reorder now".
- Destructive buttons name the consequence: "Delete order", "Void shift" (confirmed via modal, §10).

## 7. Toast standards

- Confirm the truth of what happened, briefly: *"Order saved."*, *"Refund issued — £24.00."*
- Success = plain confirmation (state colour handled by Design System, never colour alone).
- No celebration language ("Woohoo!"), no exclamation unless real urgency.
- Toasts state outcome, not process: *"Product added."* not *"We're adding your product…"*.

## 8. Error standards

- Say what happened + what to do: *"Couldn't save the order. Check your connection and try again."*
- Never blame the user; never show codes/stack traces in chrome.
- Offline is a **state**, not an error: *"You're offline. Orders will sync when you reconnect."*
- Calm, not alarmist — even for failures.

## 9. Empty states (per [`docs/UI_PATTERNS.md`](../UI_PATTERNS.md) + `EmptyState`)

1. **Title** — present tense: *"No customers yet."*
2. **Body** — one sentence: what appears here, or the first move.
3. **Primary CTA** — one verb-led action: *"Add customer"*, *"Import customers"*.
4. Distinguish **"no data at all"** from **"no matches"** in title + body.

Examples:
- Customers (no data): *"No customers yet." / "Add your first customer, or import an existing list."*
- Open Orders (no data): *"No open orders." / "When you create an order, it'll appear here."*
- Truths (no data yet): *"Not enough trading history yet." / "Your first truths appear once you've made some sales."*

## 10. Modal copy

- **Title** = the decision: *"Delete this order?"*
- **Body** = the consequence, plainly: *"This removes the order and its line items. This can't be undone."*
- **Buttons** = `[Cancel]` + a consequence-named confirm: `[Delete order]`.
- Destructive confirms are the only place urgency language is permitted, and only truthfully.

## 11. AI voice (Arcarna Voice)

- **Never call it "AI".** It is rule-based and deterministic ([`docs/ARCARNA_VOICE.md`](../ARCARNA_VOICE.md)).
- Always confirm before a real write: *"Ready to save: Bunny, 50 Product 1 at £20 each. Save it?"*
- Short, spoken-first, one step at a time. Asks for one missing field at a time.
- Same Arcarna tone: calm, practical, honest. No personality performance.

## 12. Report language → **Evidence**

- The noun is **Evidence**, not "report". Scheduled output is **Scheduled Evidence**.
- Action verbs: "Export evidence", "Schedule evidence", "Email evidence".
- Evidence is described by what it proves: *"Profit Analysis — what you kept this month."*
- A piece of evidence always ties back to a **Truth** it supports.

## 13. Settings language

- Sectioned, plain, instructional. Each setting says what it changes, in the owner's terms.
- Use "your business", "your locations", "your team". Avoid "tenant", "org" in chrome (use "business").
- Toggles state the **on** condition: *"Speak responses aloud"* (not "Voice setting").
- Sub-routes: **Receipts**, **Loyalty**, **Developer** (kept), under **Settings**.

## 14. Onboarding language

- Frame as revealing the owner's business, not configuring software: *"Let's set up your business so
  Arcarna can show you the truth."*
- One step, one ask. Progress is visible. Resume is always offered (resume banner copy:
  *"Pick up where you left off."*).
- Closing state is empowerment: *"You're set up. Here's your Control Centre."*

## 15. UK terminology

UK English throughout (the operator base is UK independent businesses).

- **Spelling:** organis**e**, colo**u**r, cent**re**, optimis**e**, licen**c**e (noun), recognis**e**.
- **Money:** **£** GBP; **VAT** (never "sales tax"); amounts `1,234.56`.
- **Dates/time:** `dd/mm/yyyy`; 24-hour or "9am" style per locale; "today/yesterday" relative.
- **Trade terms:** **tick** (buying on credit), **stock** (the goods), **till**, **shift**,
  **stocktake**, **supplier** (not "vendor"), **postcode**, **mobile** (not "cell").
- Never hardcode `$`/US formats; respect org locale.

## 16. Case rules

| Context | Rule | Example |
|---------|------|---------|
| Brand | UPPERCASE display, lowercase in URLs/keys | `ARCARNA` / `/arcarna` |
| Nav labels & page titles | Title Case of the approved term | "Control Centre", "Truths" |
| Buttons | Sentence case | "Create order" |
| Body / subtitles | Sentence case | "Who owes you, and is it paid?" |
| Toggles/labels | Sentence case | "Speak responses aloud" |

## 17. Marketing lines (approved)

Use verbatim or not at all; all pass §2.

- **Reveal Your Truth™** (primary tagline)
- *See what you couldn't see before.*
- *Revenue isn't profit. Arcarna shows you the difference.*
- *Every truth leads to a next move.*
- *The instrument for independent business.*

## 18. Acceptance criteria

- [ ] All nav/page titles use **approved terms** (§1, §3); no industry-default or legacy label.
- [ ] Every in-app page has a **subtitle = its question** (§5).
- [ ] Buttons are **verb + noun**, sentence case (§6).
- [ ] Toasts/errors/empty states/modals follow §7–§10.
- [ ] Assistant copy never says "AI"/"smart"/"magic" (§11).
- [ ] Reports are called **Evidence**; alerts **Signals**; recommendations **Next Moves**.
- [ ] **UK English**, £/VAT, `dd/mm/yyyy` (§15); no `$`/US defaults.
- [ ] **Zero** forbidden words (§2) — grep gate green.
- [ ] Every new noun exists in this spec **before** use (Foundation §15).

**Reference gate (CI, illustrative):**
```bash
rg -i --glob 'client/src/**' --glob 'server/templates/**' \
  -e 'AI-powered|powered by AI|streamline|seamless|leverage|all-in-one|supercharge|\bMidnight\b|sales tax' \
  && echo "LANGUAGE VIOLATION" && exit 1 || echo "language clean"
```
