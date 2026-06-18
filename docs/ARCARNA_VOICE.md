# Arcarna Voice

A first-class assistant layer that turns short, spoken or typed commands into
EPOS actions — speech-to-text in, text-to-speech out — using the **same**
engine across every input channel: the web/mobile command bar, the
microphone, Siri Shortcuts, and (future) WhatsApp voice notes.

## Principles

- **Rule-based, no AI** (mirrors `server/whatsapp/intent.ts`) — deterministic
  regex/keyword parsing, not an LLM call. Predictable, auditable, free.
- **A human always confirms** before a real order is created — Arcarna asks
  "Save it?" and waits for "Yes."/"No." (Principle 14).
- **One engine, many channels** — `processQuickEntryTurn` (pure function,
  `server/assistant/quickEntry.ts`) has no I/O. Every channel persists the
  returned `draft` and hands it back on the next turn; there's no
  server-side conversation/session storage.
- **Responses are short and action-focused** — built for being spoken aloud,
  not read.

## Architecture

| Piece | Location |
|-------|----------|
| QuickEntryEngine (pure state machine) | `server/assistant/quickEntry.ts` |
| Product lookup / order persistence | `server/assistant/store.ts` |
| Orchestration (turn -> save) | `server/assistant/engine.ts` |
| Spoken alerts & daily summary | `server/assistant/alerts.ts` |
| Authenticated routes (web/mobile) | `server/routes/assistant.ts` — `registerAssistantRoutes` |
| Public route (Siri Shortcuts) | `server/routes/assistant.ts` — `registerAssistantPublicRoutes` |
| Browser speech provider (STT/TTS) | `client/src/lib/speech.ts` |
| Floating voice/command bar UI | `client/src/components/assistant/ArcarnaAssistantBar.tsx` |

### Example flow

```
User: "Bunny wants 50 Product 1 tomorrow."
Arcarna: "What price per item?"
User: "£20 each."
Arcarna: "Any expenses?"
User: "£30 train."
Arcarna: "Ready to save: Bunny, 50 Product 1 at £20 each, train expense £30. Save it?"
User: "Yes."
Arcarna: "Done. Order saved."
```

### Speech providers

- **Default (today)**: the browser's built-in `SpeechRecognition` (STT) and
  `speechSynthesis` (TTS) — free, client-side, no extra infra.
- **Provider interface** (`SpeechProvider` in `client/src/lib/speech.ts`) is
  deliberately small (`listen`/`speak`/`stop`/`isSupported`) so a premium
  fallback (OpenAI Whisper/TTS) or a self-hosted Whisper instance can be
  swapped in later without changing any caller.

### Settings

Stored client-side in `localStorage` (`shared/storageKeys.ts`), following the
existing app convention (no server-side per-user settings table):

- `arcarna.voice.enabled` — speak responses aloud (default on).
- `arcarna.voice.style` — reserved for a future personality/voice-style
  setting; not yet read by the UI.

## API

### `POST /api/assistant/turn` (authenticated — web/mobile)

Body: `{ text: string, draft: QuickEntryDraft | null }`
Returns: `{ action: "ask"|"save"|"cancel", draft, message, voiceResponse, missingFields, savedOrderId? }`

The caller stores `draft` and passes it back on the next turn. When
`action === "save"`, the order has already been created server-side
(`savedOrderId` is its id).

### `GET /api/assistant/summary` / `GET /api/assistant/alerts`

Short spoken-friendly daily summary and active alerts (low stock, overdue
invoices, unprocessed goods receipts).

### `POST /v1/orgs/:orgId/assistant/turn` (public — Siri Shortcuts)

Same contract as the authenticated route, but authenticated with an org API
key (`Authorization: Bearer mk_live_...`) requiring the `assistant:voice`
scope. Create a key with that scope under Settings → Integrations
(`POST /api/api-keys`).

## Siri Shortcut recipe

Arcarna is a PWA, not a native app, so there's no `.shortcut` file to
install — instead, build a Shortcut once using the Shortcuts app:

1. **Get Contents of URL**
   - URL: `https://<your-domain>/v1/orgs/<orgId>/assistant/turn`
   - Method: `POST`
   - Headers: `Authorization: Bearer mk_live_...` (a key with the
     `assistant:voice` scope), `Content-Type: application/json`
   - Request Body (JSON): `{ "text": "<Dictated Text>", "draft": null }`
     — use "Dictate Text" as an earlier step to capture the spoken command,
     and store the running `draft` in a Shortcuts variable so multi-turn
     conversations work (see below).
2. **Get Dictionary Value** for key `voiceResponse` from the response.
3. **Speak Text** with that value.
4. Loop: set a Shortcuts variable to the response's `draft` field and feed
   it back into step 1's request body on the next invocation, until
   `action` is `"save"` or `"cancel"`.

This can be triggered by "Hey Siri, talk to Arcarna" once named and saved.
