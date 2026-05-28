/**
 * C5 — Stub for external channel ingest adapters (WhatsApp, web cart, phone).
 * Implementations translate provider payloads into internal order/product DTOs
 * and call `POST /api/orders` (session) or server-side engine with service auth.
 */
export type ChannelAdapterContext = {
  orgId: string;
  /** Optional trace for logs */
  correlationId?: string;
};

export interface ChannelIngestAdapter {
  readonly channel: "web" | "whatsapp" | "phone" | "api";
  /** Validate raw webhook / message payload */
  parseIncoming(raw: unknown): { ok: true; body: unknown } | { ok: false; error: string };
  /** Map parsed body to PlaceOrderInput–compatible shape (future). */
  toPlaceOrderInput?(body: unknown): Record<string, unknown>;
}

export function notImplementedAdapter(channel: ChannelIngestAdapter["channel"]): ChannelIngestAdapter {
  return {
    channel,
    parseIncoming() {
      return { ok: false, error: "Adapter not wired — see docs/CHANNEL_INGEST.md" };
    },
  };
}
