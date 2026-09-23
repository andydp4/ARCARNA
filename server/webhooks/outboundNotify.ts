import { createHmac } from "crypto";
import { storage } from "../storage";
import { assertPublicHttpsUrl } from "../lib/safeUrl";
import { orderIdInPayload, orgIdInPayload, webhookPayloadFor } from "@shared/webhookPayload";

const WEBHOOK_TIMEOUT_MS = 5_000;

/**
 * The org an event belongs to. Order events carry only the order id (the
 * org is not repeated in every payload), so it is read from the order.
 */
async function resolveOrgId(payload: unknown): Promise<string | null> {
  const direct = orgIdInPayload(payload);
  if (direct) return direct;
  const orderId = orderIdInPayload(payload);
  if (!orderId) return null;
  const { db } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const res = await db.execute(sql`SELECT org_id FROM orders WHERE id = ${orderId} LIMIT 1`);
  const row = res.rows?.[0] as { org_id?: string } | undefined;
  return row?.org_id ? String(row.org_id) : null;
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
  // An explicit payload per event (CMP-14): never the internal outbox payload.
  const payload = webhookPayloadFor(event.eventType, event.payload);
  if (!payload) return;
  const orgId = await resolveOrgId(event.payload);
  if (!orgId) return;

  const hooks = await storage.listActiveOutboundWebhooksForOrg(orgId);
  if (hooks.length === 0) return;
  const bodyObj = {
    eventId: event.eventId,
    eventType: event.eventType,
    payload,
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
