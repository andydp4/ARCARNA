/**
 * Parse inbound WhatsApp Cloud API webhook payloads into normalised events.
 *
 * The parser is defensive: malformed or partial payloads yield empty results
 * rather than throwing, so the webhook can always return 200 quickly.
 */
import type { WhatsappMessageStatus, WhatsappMessageType } from "@shared/schema";

export interface ParsedInboundMessage {
  /** Meta phone_number_id of the receiving business number (org routing key). */
  phoneNumberId: string;
  businessAccountId?: string;
  /** Sender WhatsApp ID (international digits, no "+"). */
  waId: string;
  phone: string;
  profileName?: string;
  whatsappMessageId: string;
  timestamp?: Date;
  messageType: WhatsappMessageType;
  body?: string;
  mediaId?: string;
  mediaMimeType?: string;
  raw: unknown;
}

export interface ParsedStatusUpdate {
  phoneNumberId: string;
  whatsappMessageId: string;
  status: WhatsappMessageStatus;
  recipientId?: string;
  timestamp?: Date;
  raw: unknown;
}

export interface ParsedWebhook {
  messages: ParsedInboundMessage[];
  statuses: ParsedStatusUpdate[];
}

const KNOWN_TYPES: WhatsappMessageType[] = [
  "text",
  "image",
  "document",
  "audio",
  "video",
  "location",
];

const KNOWN_STATUSES: WhatsappMessageStatus[] = [
  "sent",
  "delivered",
  "read",
  "failed",
];

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function toDate(ts: unknown): Date | undefined {
  const n = typeof ts === "string" ? Number(ts) : typeof ts === "number" ? ts : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return new Date(n * 1000);
}

function normaliseType(type: unknown): WhatsappMessageType {
  return KNOWN_TYPES.includes(type as WhatsappMessageType)
    ? (type as WhatsappMessageType)
    : "unknown";
}

function extractMediaAndBody(
  type: WhatsappMessageType,
  msg: Record<string, unknown>,
): { body?: string; mediaId?: string; mediaMimeType?: string } {
  if (type === "text") {
    const text = asRecord(msg.text);
    return { body: typeof text?.body === "string" ? text.body : undefined };
  }
  if (type === "location") {
    const loc = asRecord(msg.location);
    if (loc) {
      const name = typeof loc.name === "string" ? loc.name : "";
      const addr = typeof loc.address === "string" ? loc.address : "";
      const coords = `${loc.latitude ?? ""},${loc.longitude ?? ""}`;
      return { body: [name, addr, coords].filter(Boolean).join(" • ") };
    }
    return {};
  }
  // Media types: image/document/audio/video share { id, mime_type, caption }
  const media = asRecord(msg[type]);
  if (media) {
    return {
      body: typeof media.caption === "string" ? media.caption : undefined,
      mediaId: typeof media.id === "string" ? media.id : undefined,
      mediaMimeType: typeof media.mime_type === "string" ? media.mime_type : undefined,
    };
  }
  return {};
}

export function parseWebhookPayload(payload: unknown): ParsedWebhook {
  const result: ParsedWebhook = { messages: [], statuses: [] };
  const root = asRecord(payload);
  if (!root) return result;

  for (const entryRaw of asArray(root.entry)) {
    const entry = asRecord(entryRaw);
    if (!entry) continue;
    const businessAccountId = typeof entry.id === "string" ? entry.id : undefined;

    for (const changeRaw of asArray(entry.changes)) {
      const change = asRecord(changeRaw);
      const value = asRecord(change?.value);
      if (!value) continue;

      const metadata = asRecord(value.metadata);
      const phoneNumberId =
        typeof metadata?.phone_number_id === "string" ? metadata.phone_number_id : "";
      if (!phoneNumberId) continue;

      // Build a wa_id -> profile name map from contacts.
      const profileByWaId = new Map<string, string>();
      for (const contactRaw of asArray(value.contacts)) {
        const contact = asRecord(contactRaw);
        const waId = typeof contact?.wa_id === "string" ? contact.wa_id : "";
        const profile = asRecord(contact?.profile);
        const name = typeof profile?.name === "string" ? profile.name : "";
        if (waId && name) profileByWaId.set(waId, name);
      }

      for (const msgRaw of asArray(value.messages)) {
        const msg = asRecord(msgRaw);
        if (!msg) continue;
        const waId = typeof msg.from === "string" ? msg.from : "";
        const id = typeof msg.id === "string" ? msg.id : "";
        if (!waId || !id) continue;
        const type = normaliseType(msg.type);
        const { body, mediaId, mediaMimeType } = extractMediaAndBody(type, msg);
        result.messages.push({
          phoneNumberId,
          businessAccountId,
          waId,
          phone: waId,
          profileName: profileByWaId.get(waId),
          whatsappMessageId: id,
          timestamp: toDate(msg.timestamp),
          messageType: type,
          body,
          mediaId,
          mediaMimeType,
          raw: msgRaw,
        });
      }

      for (const statusRaw of asArray(value.statuses)) {
        const status = asRecord(statusRaw);
        if (!status) continue;
        const id = typeof status.id === "string" ? status.id : "";
        const statusVal = status.status;
        if (!id || !KNOWN_STATUSES.includes(statusVal as WhatsappMessageStatus)) continue;
        result.statuses.push({
          phoneNumberId,
          whatsappMessageId: id,
          status: statusVal as WhatsappMessageStatus,
          recipientId: typeof status.recipient_id === "string" ? status.recipient_id : undefined,
          timestamp: toDate(status.timestamp),
          raw: statusRaw,
        });
      }
    }
  }

  return result;
}
