# Arcarna Voice (order drafting)

The floating "arcarna Voice" command bar (`ArcarnaAssistantBar.tsx`) is gone
(v1.2.1). It only ever drafted orders — it couldn't answer a question, open a
report, or do anything else — so it was folded into **Ask arcarna**, the one
assistant in the app, rather than kept as a second, narrower box. Ask arcarna
answers questions AND starts orders, spoken or typed, from the same header
button and the same Sheet.

Order-drafting itself did not change: same engine, same rules, same
"drafts, never saves" guarantee. Only the front door did.

> **v1.2 Phase 1B (owner Q19), still true:** the assistant never saves an
> order. It is too literal to be trusted with money. A resolved request opens
> a draft in the till, which prices it, checks stock, takes payment and
> records the sale like any other. The Siri Shortcut route
> (`POST /v1/orgs/:orgId/assistant/turn`) was removed earlier as unused; the
> web/mobile route (`POST /api/assistant/turn`) is gone too now that Ask
> arcarna calls the same engine directly rather than over HTTP.

## Principles

- **Rule-based lookups, no AI, for the resolving step.** Ask arcarna (an LLM)
  understands the request and rewrites it into the shape
  `server/whatsapp/intent.ts`'s deterministic parser expects; the parser
  itself is unchanged — same regex/keyword matching as before, not an LLM
  call, for exactly which product and customer a name means.
- **Drafts, never orders.** Nothing is written: no order, no customer. The
  till is where a price is set and payment taken.
- **No guessing.** No single price for every item (the till prices each
  product) and no default payment method. A name that matches several
  customers is asked about; a name that matches nobody is left for the
  cashier to pick in the till.
- **One engine, called once per request.** `processQuickEntryTurn` (pure
  function, `server/assistant/quickEntry.ts`) still has no I/O, but Ask
  arcarna's `draft_order` tool calls it fresh each time rather than holding a
  draft between turns: a request either resolves cleanly in one call, or the
  tool comes back asking for whatever was unclear, and the model re-asks the
  person and calls again with the whole request restated.

## Architecture

| Piece | Location |
|-------|----------|
| QuickEntryEngine (pure state machine) | `server/assistant/quickEntry.ts` |
| Product and customer lookup (read-only) | `server/assistant/store.ts` |
| Orchestration (turn -> customer lookup) | `server/assistant/engine.ts` |
| Spoken alerts & daily summary | `server/assistant/alerts.ts` |
| Summary/alerts routes (web/mobile) | `server/routes/assistant.ts` |
| The order-drafting tool | `server/ask/tools.ts` (`draft_order`) |
| Ask arcarna's engine (streams the `till_draft` event) | `server/ask/engine.ts` |
| Browser speech provider (STT/TTS) | `client/src/lib/speech.ts` |
| Ask arcarna panel (mic, chat, till hand-off) | `client/src/components/ask/AskPanel.tsx` |
| Till hand-off (shared with WhatsApp drafts) | `client/src/lib/whatsappDraft.ts` |

### Example flow

```
User (typed or spoken, in Ask arcarna): "Create an order for Bunny, 50 Product 1, for tomorrow."
arcarna calls draft_order with text: "Bunny wants 50 Product 1, for tomorrow."
-> more than one customer named Bunny: arcarna asks "Which Bunny — Bunny Smith or Bunny Jones?"
User: "Bunny Jones."
arcarna calls draft_order again with the whole request restated: "Bunny Jones wants 50 Product 1, for tomorrow."
-> resolves cleanly: the till opens with the items and customer, in Create order.
```

## API

### `draft_order` tool (Ask arcarna only — see `server/ask/tools.ts`)

Input: `{ text: string }` — the request, rewritten into
`"<Customer name, or Walk-in> wants <quantity> <product>[ and ...][, for <day>]."`

Calls `runAssistantTurn(orgId, null, text)` (`server/assistant/engine.ts`)
fresh each time. Once the resulting draft reaches `status: "confirming"` (a
customer is resolved — named or `null` for "pick in the till" — and at least
one product matched), the tool result carries `tillDraft: { customerId,
customerName, items: [{ sku, name, quantity }], note? }` and the engine
emits a `till_draft` stream event; the app (`AskPanel.tsx`) stashes it and
navigates to Create order. Anything less resolved comes back as a plain
message for the model to relay and ask about.

### `GET /api/assistant/summary` / `GET /api/assistant/alerts`

Short spoken-friendly daily summary and active alerts (low stock, overdue
invoices, unprocessed goods receipts). Manager and above.
