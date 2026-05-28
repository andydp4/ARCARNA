# Channel ingest & external adapters (C5)

This document describes how **non-POS channels** (web checkout, WhatsApp, phone orders) should integrate with MidnightEPOS without duplicating pricing or stock rules inside each channel.

## Principles (see `ARCHITECTURE.md`)

1. **Single write path** — External channels eventually call the same domain operations as the POS (e.g. `placeOrder` / `POST /api/orders`), not ad-hoc SQL.
2. **Tenant isolation** — Every request carries an `orgId` (header, API key binding, or signed channel token).
3. **Provenance** — Persist `orders.channel` (`pos`, `web`, `api`, `whatsapp`, `phone`) for reporting and support.
4. **Least privilege** — API keys use `scopes` (e.g. `products:read` only for catalog sync).

## Implemented building blocks (C1–C4)

| Piece | Location |
|-------|-----------|
| **Schema** | `orders.channel`; `api_keys`; `outbound_webhooks` (`migrations/012_channel_readiness.sql`, `shared/schema.ts`) |
| **Org API keys** | `POST/GET /api/api-keys`, `POST /api/api-keys/:id/revoke` (`server/routes/channels.ts`) |
| **Public read** | `GET /v1/orgs/:orgId/products` with `Authorization: Bearer mk_live_...` |
| **Outbound webhooks** | `GET/POST /api/webhooks`; delivery on outbox dispatch (`server/webhooks/outboundNotify.ts`) |

### Webhook verification (receiver side)

- Body: JSON `{ eventId, eventType, payload }`.
- Header `X-Midnight-Signature`: lowercase hex **HMAC-SHA256** of the raw body bytes using the shared `secret` you configured in `POST /api/webhooks`.

## Adapter interface (ingest)

Implement one adapter per external channel. Adapters **translate** channel-specific payloads into internal DTOs and call HTTP APIs or the domain engine.

See stub: `server/channels/ingestAdapter.ts`.

### Next steps (not in this PR)

- Signed webhook replay / idempotency keys per delivery.
- Narrow API key scopes (`orders:write`, `inventory:read`, …).
- Channel-specific rate limits and IP allow lists.
