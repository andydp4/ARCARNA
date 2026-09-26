/**
 * "Message the customer instead" (v1.2 Phase 6, PRV-11).
 *
 * Offered before a request for contact details: the server fills an approved
 * WhatsApp template and sends it to the number on file, so the manager never
 * sees the number. Only templates Meta has approved (synced as APPROVED) are
 * sent; the local starting points are refused. Every send is logged in the
 * customer data access log before it goes, so a message never leaves unlogged.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { customerAccessLog, customers, organizations, orders } from "@shared/schema";
import {
  CUSTOMER_MESSAGES,
  CUSTOMER_MESSAGE_LABELS,
  EMAIL_NOT_SET_UP,
  MESSAGES_NEEDING_ORDER,
  WHATSAPP_UTILITY_COST_NOTE,
  messageParams,
  type CustomerMessage,
} from "@shared/contactAccess";
import { orderRefOf } from "@shared/pricing/priceGuard";
import { ContactAccessError, amountOwedBy } from "./contactRequests";
import { readContactField } from "./customerView";

type Where = { ipAddress?: string; userAgent?: string };
export type Sender = { userId: string; role: string };

/** WhatsApp messages go out in British English; the approved templates are en_GB. */
const TEMPLATE_LANGUAGE = "en_GB";

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY?.trim();
}

export async function whatsappConfigured(): Promise<boolean> {
  const { canSendWhatsapp, getWhatsappConfig } = await import("../whatsapp/config");
  return canSendWhatsapp(getWhatsappConfig());
}

export type MessageOption = { message: CustomerMessage; label: string; available: boolean; reason: string | null; needsOrder: boolean };

/** Which messages can go now, and why not when one cannot. */
export async function messagingOptions(orgId: string): Promise<{
  whatsapp: boolean;
  email: boolean;
  emailReason: string | null;
  costNote: string;
  messages: MessageOption[];
}> {
  const whatsapp = await whatsappConfigured();
  const store = await import("../whatsapp/store");
  const templates = await store.listTemplates(orgId);
  const approved = new Set(
    templates.filter((t) => t.status === "APPROVED" && t.language === TEMPLATE_LANGUAGE).map((t) => t.templateName),
  );
  return {
    whatsapp,
    email: emailConfigured(),
    emailReason: emailConfigured() ? null : EMAIL_NOT_SET_UP,
    costNote: WHATSAPP_UTILITY_COST_NOTE,
    messages: CUSTOMER_MESSAGES.map((message) => {
      const reason = !whatsapp
        ? "WhatsApp is not set up for this shop."
        : !approved.has(message)
          ? "This template is not approved by WhatsApp yet. An admin can sync templates once Meta approves it."
          : null;
      return {
        message,
        label: CUSTOMER_MESSAGE_LABELS[message],
        available: reason == null,
        reason,
        needsOrder: MESSAGES_NEEDING_ORDER.includes(message),
      };
    }),
  };
}

/**
 * Send one approved template to a customer. Returns only that it went: the
 * number is read here, used, and never returned or logged in full.
 */
export async function sendCustomerMessage(args: {
  orgId: string;
  customerId: string;
  message: CustomerMessage;
  orderId?: string | null;
  sender: Sender;
  where?: Where;
}): Promise<{ sent: true; message: CustomerMessage }> {
  const { orgId, customerId, message, sender } = args;
  const { canSendWhatsapp, getWhatsappConfig } = await import("../whatsapp/config");
  const cfg = getWhatsappConfig();
  if (!canSendWhatsapp(cfg)) throw new ContactAccessError("WhatsApp is not set up for this shop.", 409, "WHATSAPP_NOT_SET_UP");

  const store = await import("../whatsapp/store");
  const template = await store.getTemplate(orgId, message, TEMPLATE_LANGUAGE);
  // Only what Meta has approved goes out; a local starting point is refused.
  if (!template || template.status !== "APPROVED") {
    throw new ContactAccessError(
      "This message is not approved by WhatsApp yet, so it cannot be sent.",
      422,
      "TEMPLATE_NOT_APPROVED",
    );
  }

  const [customer] = await db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.orgId, orgId)))
    .limit(1);
  if (!customer) throw new ContactAccessError("Customer not found", 404, "CUSTOMER_NOT_FOUND");

  let order: { id: string; status: string | null } | null = null;
  if (args.orderId) {
    const [row] = await db
      .select({ id: orders.id, status: orders.status, customerId: orders.customerId })
      .from(orders)
      .where(and(eq(orders.id, args.orderId), eq(orders.orgId, orgId)))
      .limit(1);
    if (!row || row.customerId !== customerId) throw new ContactAccessError("That order is not this customer's.", 400, "ORDER_NOT_THEIRS");
    order = { id: row.id, status: row.status };
  }

  const [org] = await db
    .select({ name: organizations.name, tradingName: organizations.tradingName, phone: organizations.phone, address: organizations.address })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  const params = messageParams(message, {
    customerName: customer.name,
    shopName: org?.tradingName?.trim() || org?.name || "the shop",
    shopPhone: org?.phone ?? null,
    shopAddress: org?.address ?? null,
    orderRef: order ? orderRefOf(order.id) : null,
    orderStatus: order?.status ?? null,
    amountOwed: message === "payment_reminder" ? await amountOwedBy(orgId, customerId) : null,
  });
  if (!params.ok) throw new ContactAccessError(params.reason, 422, "MESSAGE_INCOMPLETE");

  const phone = await readContactField(orgId, customerId, "phone");
  if (!phone.value) throw new ContactAccessError("There is no number on file for this customer.", 404, "NO_PHONE");
  const { toWhatsappNumber } = await import("../whatsapp/phone");
  const waId = toWhatsappNumber(phone.value);
  if (!waId) throw new ContactAccessError("The number on file cannot receive WhatsApp.", 422, "PHONE_UNUSABLE");

  // Logged before it goes: no log, no message.
  const logId = await (async () => {
    try {
      const [row] = await db
        .insert(customerAccessLog)
        .values({
          orgId,
          customerId,
          actorUserId: sender.userId.slice(0, 255),
          actorRole: sender.role.slice(0, 16),
          action: "message_sent",
          orderId: order?.id ?? null,
          metadata: { template: message, channel: "whatsapp", outcome: "sending" },
          ipAddress: args.where?.ipAddress ?? null,
          userAgent: args.where?.userAgent ?? null,
        })
        .returning({ id: customerAccessLog.id });
      return row.id as string;
    } catch (error) {
      console.error("[CustomerMessaging] log failed; not sending:", error);
      throw new ContactAccessError("This could not be logged, so it was not sent. Try again in a moment.", 503, "LOG_FAILED");
    }
  })();

  const { sendTemplateMessage } = await import("../whatsapp/client");
  const result = await sendTemplateMessage(waId, message, TEMPLATE_LANGUAGE, params.params, cfg);
  await db
    .update(customerAccessLog)
    .set({ metadata: { template: message, channel: "whatsapp", outcome: result.ok ? "sent" : "failed" } })
    .where(eq(customerAccessLog.id, logId))
    .catch((e: unknown) => console.error("[CustomerMessaging] outcome update failed:", e));

  // The conversation keeps a copy for the inbox, with the template's text, not the number.
  const account = await store.getPrimaryAccount(orgId).catch(() => null);
  if (account) {
    await store.recordOutboundStatus(account.id, result.ok ? "sent" : "failed").catch(() => {});
    try {
      const conversation = await store.findOrCreateConversation({ orgId, whatsappAccountId: account.id, waId, phone: `+${waId}` });
      await store.insertOutboundMessage({
        orgId,
        conversationId: conversation.id,
        whatsappMessageId: result.ok ? result.messageId : undefined,
        body: `[template: ${message}] ${(template.body ?? "").trim()}`.trim(),
        status: result.ok ? "sent" : "failed",
        sentByUserId: sender.userId,
      });
    } catch (error) {
      console.error("[CustomerMessaging] conversation copy failed:", error);
    }
  }
  if (!result.ok) throw new ContactAccessError("WhatsApp did not accept the message. Try again later.", 502, "SEND_FAILED");
  return { sent: true, message };
}

