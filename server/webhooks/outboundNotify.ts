import { createHmac } from "crypto";
import { storage } from "../storage";

function orgIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const order = p.order as Record<string, unknown> | undefined;
  if (order?.orgId) return String(order.orgId);
  if (order?.org_id) return String(order.org_id);
  return null;
}

/**
 * C4 — best-effort POST to org webhooks after an outbox event is marked dispatched.
 * Signature: hex SHA256-HMAC of raw body with the webhook's shared secret.
 */
export async function notifyOutboundWebhooksForEvent(event: {
  eventId: string;
  eventType: string;
  payload: unknown;
}): Promise<void> {
  const orgId = orgIdFromPayload(event.payload);
  if (!orgId) return;

  const hooks = await storage.listActiveOutboundWebhooksForOrg(orgId);
  const bodyObj = {
    eventId: event.eventId,
    eventType: event.eventType,
    payload: event.payload,
  };
  const body = JSON.stringify(bodyObj);

  for (const h of hooks) {
    const types = (h.eventTypes as string[]) ?? [];
    if (!types.includes(event.eventType)) continue;
    const sig = createHmac("sha256", h.secret).update(body).digest("hex");
    void fetch(h.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Midnight-Signature": sig,
        "X-Midnight-Event": event.eventType,
      },
      body,
    }).catch(() => {});
  }
}
