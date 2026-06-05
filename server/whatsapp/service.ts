/**
 * WhatsApp orchestration: webhook ingestion and the customer service window.
 *
 * Ingestion is intentionally lightweight so the webhook can return 200 quickly:
 * route by phone_number_id, store the message idempotently, auto-link a customer
 * by phone, and bump conversation rollups. Heavier downstream work (order-intent
 * parsing, outbox events) is layered on in later phases.
 */
import type { ParsedInboundMessage, ParsedWebhook } from "./parse";
import { parseWebhookPayload } from "./parse";
import * as store from "./store";
import { parseOrderIntent } from "./intent";
import type { WhatsappMessageType } from "@shared/schema";

/** WhatsApp's free-form customer service window: 24h from the last inbound message. */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isWithinServiceWindow(
  lastInboundAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!lastInboundAt) return false;
  const ts = lastInboundAt instanceof Date ? lastInboundAt.getTime() : Date.parse(lastInboundAt);
  if (!Number.isFinite(ts)) return false;
  return now.getTime() - ts < SERVICE_WINDOW_MS;
}

/** Human-readable preview for a message (media types get a label). */
export function previewFor(messageType: WhatsappMessageType, body?: string): string {
  if (body && body.trim()) return body.trim();
  switch (messageType) {
    case "image":
      return "[image]";
    case "document":
      return "[document]";
    case "audio":
      return "[audio]";
    case "video":
      return "[video]";
    case "location":
      return "[location]";
    default:
      return "[message]";
  }
}

export interface IngestSummary {
  received: number;
  stored: number;
  duplicates: number;
  skippedNoAccount: number;
  statusUpdates: number;
  autoLinked: number;
  orderIntents: number;
}

async function ingestMessage(
  msg: ParsedInboundMessage,
  summary: IngestSummary,
): Promise<void> {
  summary.received += 1;
  const account = await store.getAccountByPhoneNumberId(msg.phoneNumberId);
  if (!account || !account.orgId) {
    summary.skippedNoAccount += 1;
    return;
  }
  await store.touchAccountWebhook(account.id);

  const conversation = await store.findOrCreateConversation({
    orgId: account.orgId,
    whatsappAccountId: account.id,
    waId: msg.waId,
    phone: msg.phone,
    profileName: msg.profileName,
  });

  const inserted = await store.insertInboundMessage({
    orgId: account.orgId,
    conversationId: conversation.id,
    whatsappMessageId: msg.whatsappMessageId,
    messageType: msg.messageType,
    body: msg.body,
    mediaId: msg.mediaId,
    mediaMimeType: msg.mediaMimeType,
    raw: msg.raw,
    occurredAt: msg.timestamp,
  });

  if (!inserted) {
    summary.duplicates += 1;
    return;
  }
  summary.stored += 1;

  await store.bumpConversationInbound({
    conversationId: conversation.id,
    preview: previewFor(msg.messageType, msg.body),
    at: msg.timestamp ?? new Date(),
  });

  // Auto-link to an existing customer by phone when not already linked.
  let linkedCustomerId = conversation.customerId;
  if (!linkedCustomerId) {
    const customer = await store.findCustomerByPhone(account.orgId, msg.phone);
    if (customer) {
      await store.linkConversationCustomer({
        orgId: account.orgId,
        conversationId: conversation.id,
        customerId: customer.id,
      });
      linkedCustomerId = customer.id;
      summary.autoLinked += 1;
    }
  }

  // Order-intent parsing for text messages that look like an order.
  if (msg.messageType === "text" && msg.body?.trim()) {
    try {
      const products = await store.getProductsForIntent(account.orgId);
      const intent = parseOrderIntent(msg.body, products);
      if (intent.isOrderLike && intent.items.length > 0) {
        await store.createOrderIntent({
          orgId: account.orgId,
          conversationId: conversation.id,
          messageId: inserted.id,
          customerId: linkedCustomerId,
          parsedItems: intent.items,
          rawText: msg.body,
          confidence: intent.confidence,
          status: "suggested",
        });
        summary.orderIntents += 1;
      }
    } catch (err) {
      console.error("[whatsapp] order-intent parse failed", {
        waMessageId: msg.whatsappMessageId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/** Parse and persist a webhook payload. Never throws on malformed data. */
export async function ingestWebhook(payload: unknown): Promise<IngestSummary> {
  const summary: IngestSummary = {
    received: 0,
    stored: 0,
    duplicates: 0,
    skippedNoAccount: 0,
    statusUpdates: 0,
    autoLinked: 0,
    orderIntents: 0,
  };
  let parsed: ParsedWebhook;
  try {
    parsed = parseWebhookPayload(payload);
  } catch {
    return summary;
  }

  for (const msg of parsed.messages) {
    try {
      await ingestMessage(msg, summary);
    } catch (err) {
      console.error("[whatsapp] failed to ingest message", {
        waMessageId: msg.whatsappMessageId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  for (const status of parsed.statuses) {
    try {
      const account = await store.getAccountByPhoneNumberId(status.phoneNumberId);
      if (!account?.orgId) continue;
      await store.applyStatusUpdate(account.orgId, status.whatsappMessageId, status.status);
      summary.statusUpdates += 1;
    } catch (err) {
      console.error("[whatsapp] failed to apply status update", {
        waMessageId: status.whatsappMessageId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}
