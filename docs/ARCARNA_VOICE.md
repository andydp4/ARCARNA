# Arcarna Voice

A small assistant that turns short, spoken or typed commands into a **till
draft** — speech-to-text in, text-to-speech out — through the web/mobile
command bar and the microphone.

> **v1.2 Phase 1B (owner Q19):** the assistant no longer saves orders. It is
> too literal to be trusted with money, and will be rebuilt later on the
> "Ask arcarna" engine. Until then a confirmed draft opens in the till, which
> prices it, takes payment and records the sale like any other. The Siri
> Shortcut route (`POST /v1/orgs/:orgId/assistant/turn`) has been removed:
> it was unused and could not be enabled.

## Principles

- **Rule-based, no AI** (mirrors `server/whatsapp/intent.ts`) — deterministic
  regex/keyword parsing, not an LLM call.
- **Drafts, never orders.** Nothing is written by the assistant: no order, no
  customer. The till is where a price is set and payment taken.
- **No guessing.** No single spoken price for every item (the till prices
  each product) and no default payment method. A name that matches several
  customers is asked about; a name that matches nobody is left for the
  cashier to pick in the till.
- **One engine** — `processQuickEntryTurn` (pure function,
  `server/assistant/quickEntry.ts`) has no I/O. The caller persists the
  returned `draft` and hands it back on the next turn.

## Architecture

| Piece | Location |
|-------|----------|
| QuickEntryEngine (pure state machine) | `server/assistant/quickEntry.ts` |
| Product and customer lookup (read-only) | `server/assistant/store.ts` |
| Orchestration (turn -> customer lookup) | `server/assistant/engine.ts` |
| Spoken alerts & daily summary | `server/assistant/alerts.ts` |
| Authenticated routes (web/mobile) | `server/routes/assistant.ts` |
| Browser speech provider (STT/TTS) | `client/src/lib/speech.ts` |
| Floating voice/command bar UI | `client/src/components/assistant/ArcarnaAssistantBar.tsx` |
| Till hand-off (shared with WhatsApp drafts) | `client/src/lib/whatsappDraft.ts` |

### Example flow

```
User: "Bunny wants 50 Product 1 tomorrow."
Arcarna: "More than one customer matches Bunny: 1. Bunny Smith, 2. Bunny Jones. Which one?"
User: "2"
Arcarna: "Ready to open in the till: Bunny Jones, 50 Product 1, for tomorrow. Open it?"
User: "Yes."
Arcarna: "Opening it in the till."   -> the till opens with the items and customer
```

## API

### `POST /api/assistant/turn` (authenticated — web/mobile)

Body: `{ text: string, draft: QuickEntryDraft | null }`
Returns: `{ action: "ask"|"draft"|"cancel", draft, message, voiceResponse, missingFields, tillDraft? }`

When `action === "draft"`, `tillDraft` holds `{ customerId, customerName,
items: [{ sku, name, quantity }], note? }` and the app opens the till with it.

### `GET /api/assistant/summary` / `GET /api/assistant/alerts`

Short spoken-friendly daily summary and active alerts (low stock, overdue
invoices, unprocessed goods receipts). Manager and above.
