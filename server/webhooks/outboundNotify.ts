import { createHmac } from "crypto";
import { storage } from "../storage";
import { assertPublicHttpsUrl } from "../lib/safeUrl";

const WEBHOOK_TIMEOUT_MS = 5_000;

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
    // Re-resolve on every delivery rather than trusting the registration check.
    // POST /api/webhooks only asserted url.startsWith("https://"), which
    // "https://127.0.0.1:5000/" and "https://169.254.169.254/" both satisfy —
    // so an org admin could point this loop at the host's own network. Checking
    // here rather than only at registration also closes DNS rebinding, where a
    // hostname resolves publicly when saved and privately later.
    const safeUrl = await assertPublicHttpsUrl(h.url);
    if (!safeUrl) {
      console.warn(
        `[outboundNotify] refusing webhook ${h.id}: ${h.url} does not resolve to a public address`,
      );
      continue;
    }

    const sig = createHmac("sha256", h.secret).update(body).digest("hex");
    // Bounded: this is fire-and-forget, so without a timeout a hanging endpoint
    // holds a socket and its payload for as long as the peer cares to stall.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    void fetch(safeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Arcarna-Signature": sig,
        "X-Arcarna-Event": event.eventType,
      },
      body,
      // A 3xx to an internal address would otherwise bypass the check above.
      redirect: "manual",
      signal: controller.signal,
    })
      .catch(() => {})
      .finally(() => clearTimeout(timeout));
  }
}
