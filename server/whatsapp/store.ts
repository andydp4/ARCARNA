/**
 * WhatsApp data-access layer (org-scoped).
 *
 * Direct Drizzle access mirrors the pattern in server/eventBus.ts. Every query
 * except the inbound routing lookup (`getAccountByPhoneNumberId`, keyed by a
 * globally-unique Meta phone_number_id) is scoped by orgId (Principle 3/16).
 */
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  customers,
  orders,
  products,
  whatsappAccounts,
  whatsappConversations,
  whatsappCustomerLinks,
  whatsappMessages,
  whatsappOrderIntents,
  type Customer,
  type Order,
  type WhatsappAccount,
  type WhatsappConversation,
  type WhatsappMessage,
  type WhatsappMessageDirection,
  type WhatsappMessageStatus,
  type WhatsappMessageType,
  type WhatsappOrderIntent,
  type WhatsappOrderIntentStatus,
  type WhatsappParsedItem,
} from "@shared/schema";
import { phonesMatch } from "./phone";
import type { IntentProduct } from "./intent";

/** Routing lookup: which org owns the receiving WhatsApp number. */
export async function getAccountByPhoneNumberId(
  phoneNumberId: string,
): Promise<WhatsappAccount | null> {
  const [row] = await db
    .select()
    .from(whatsappAccounts)
    .where(eq(whatsappAccounts.phoneNumberId, phoneNumberId))
    .limit(1);
  return row ?? null;
}

export async function listAccounts(orgId: string): Promise<WhatsappAccount[]> {
  return db.select().from(whatsappAccounts).where(eq(whatsappAccounts.orgId, orgId));
}

export async function getPrimaryAccount(orgId: string): Promise<WhatsappAccount | null> {
  const [row] = await db
    .select()
    .from(whatsappAccounts)
    .where(eq(whatsappAccounts.orgId, orgId))
    .orderBy(desc(whatsappAccounts.createdAt))
    .limit(1);
  return row ?? null;
}

export async function touchAccountWebhook(accountId: string): Promise<void> {
  await db
    .update(whatsappAccounts)
    .set({ lastWebhookAt: new Date(), updatedAt: new Date() })
    .where(eq(whatsappAccounts.id, accountId));
}

export async function recordOutboundStatus(
  accountId: string,
  status: string,
): Promise<void> {
  await db
    .update(whatsappAccounts)
    .set({ lastOutboundAt: new Date(), lastOutboundStatus: status, updatedAt: new Date() })
    .where(eq(whatsappAccounts.id, accountId));
}

/** Find-or-create the conversation for (account, waId). */
export async function findOrCreateConversation(params: {
  orgId: string;
  whatsappAccountId: string;
  waId: string;
  phone: string;
  profileName?: string;
}): Promise<WhatsappConversation> {
  const [existing] = await db
    .select()
    .from(whatsappConversations)
    .where(
      and(
        eq(whatsappConversations.whatsappAccountId, params.whatsappAccountId),
        eq(whatsappConversations.waId, params.waId),
      ),
    )
    .limit(1);
  if (existing) {
    // Backfill profile name if we now know it.
    if (params.profileName && !existing.profileName) {
      await db
        .update(whatsappConversations)
        .set({ profileName: params.profileName, updatedAt: new Date() })
        .where(eq(whatsappConversations.id, existing.id));
      return { ...existing, profileName: params.profileName };
    }
    return existing;
  }
  const [created] = await db
    .insert(whatsappConversations)
    .values({
      orgId: params.orgId,
      whatsappAccountId: params.whatsappAccountId,
      waId: params.waId,
      phone: params.phone,
      profileName: params.profileName,
      status: "open",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing({
      target: [whatsappConversations.whatsappAccountId, whatsappConversations.waId],
    })
    .returning();
  if (created) return created;
  // Lost a race — re-read.
  const [row] = await db
    .select()
    .from(whatsappConversations)
    .where(
      and(
        eq(whatsappConversations.whatsappAccountId, params.whatsappAccountId),
        eq(whatsappConversations.waId, params.waId),
      ),
    )
    .limit(1);
  return row;
}

/**
 * Insert an inbound message idempotently.
 * Returns the inserted message, or null when the whatsapp_message_id already exists.
 */
export async function insertInboundMessage(params: {
  orgId: string;
  conversationId: string;
  whatsappMessageId: string;
  messageType: WhatsappMessageType;
  body?: string;
  mediaId?: string;
  mediaMimeType?: string;
  raw: unknown;
  occurredAt?: Date;
}): Promise<WhatsappMessage | null> {
  const now = params.occurredAt ?? new Date();
  const [inserted] = await db
    .insert(whatsappMessages)
    .values({
      orgId: params.orgId,
      conversationId: params.conversationId,
      whatsappMessageId: params.whatsappMessageId,
      direction: "inbound" satisfies WhatsappMessageDirection,
      messageType: params.messageType,
      body: params.body,
      mediaId: params.mediaId,
      mediaMimeType: params.mediaMimeType,
      status: "received",
      rawPayload: params.raw as object,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: whatsappMessages.whatsappMessageId })
    .returning();
  return inserted ?? null;
}

/** Bump conversation rollups after a new inbound message. */
export async function bumpConversationInbound(params: {
  conversationId: string;
  preview: string;
  at: Date;
}): Promise<void> {
  await db
    .update(whatsappConversations)
    .set({
      lastMessageAt: params.at,
      lastInboundAt: params.at,
      lastMessagePreview: params.preview.slice(0, 512),
      unreadCount: sql`${whatsappConversations.unreadCount} + 1`,
      status: "open",
      updatedAt: new Date(),
    })
    .where(eq(whatsappConversations.id, params.conversationId));
}

export async function insertOutboundMessage(params: {
  orgId: string;
  conversationId: string;
  whatsappMessageId?: string;
  messageType?: WhatsappMessageType;
  body: string;
  status: WhatsappMessageStatus;
  sentByUserId?: string;
  raw?: unknown;
}): Promise<WhatsappMessage> {
  const now = new Date();
  const [row] = await db
    .insert(whatsappMessages)
    .values({
      orgId: params.orgId,
      conversationId: params.conversationId,
      whatsappMessageId: params.whatsappMessageId,
      direction: "outbound" satisfies WhatsappMessageDirection,
      messageType: params.messageType ?? "text",
      body: params.body,
      status: params.status,
      sentByUserId: params.sentByUserId,
      rawPayload: (params.raw as object) ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  await db
    .update(whatsappConversations)
    .set({
      lastMessageAt: now,
      lastMessagePreview: params.body.slice(0, 512),
      updatedAt: now,
    })
    .where(eq(whatsappConversations.id, params.conversationId));
  return row;
}

/** Apply a delivery/read/failed status update keyed by Meta message id. */
export async function applyStatusUpdate(
  orgId: string,
  whatsappMessageId: string,
  status: WhatsappMessageStatus,
): Promise<void> {
  await db
    .update(whatsappMessages)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(whatsappMessages.orgId, orgId),
        eq(whatsappMessages.whatsappMessageId, whatsappMessageId),
      ),
    );
}

export interface ConversationListItem extends WhatsappConversation {
  customerName: string | null;
}

export async function listConversations(
  orgId: string,
  opts: { search?: string; limit?: number } = {},
): Promise<ConversationListItem[]> {
  const conds = [eq(whatsappConversations.orgId, orgId)];
  if (opts.search?.trim()) {
    const q = `%${opts.search.trim()}%`;
    const searchCond = or(
      ilike(whatsappConversations.profileName, q),
      ilike(whatsappConversations.phone, q),
      ilike(whatsappConversations.waId, q),
      ilike(whatsappConversations.lastMessagePreview, q),
      ilike(customers.name, q),
    );
    if (searchCond) conds.push(searchCond);
  }
  const rows = await db
    .select({
      conversation: whatsappConversations,
      customerName: customers.name,
    })
    .from(whatsappConversations)
    .leftJoin(customers, eq(whatsappConversations.customerId, customers.id))
    .where(and(...conds))
    .orderBy(desc(whatsappConversations.lastMessageAt))
    .limit(opts.limit ?? 100);
  return rows.map((r) => ({ ...r.conversation, customerName: r.customerName ?? null }));
}

export async function getConversation(
  id: string,
  orgId: string,
): Promise<ConversationListItem | null> {
  const [row] = await db
    .select({ conversation: whatsappConversations, customerName: customers.name })
    .from(whatsappConversations)
    .leftJoin(customers, eq(whatsappConversations.customerId, customers.id))
    .where(and(eq(whatsappConversations.id, id), eq(whatsappConversations.orgId, orgId)))
    .limit(1);
  if (!row) return null;
  return { ...row.conversation, customerName: row.customerName ?? null };
}

export async function listMessages(
  conversationId: string,
  orgId: string,
): Promise<WhatsappMessage[]> {
  return db
    .select()
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.conversationId, conversationId),
        eq(whatsappMessages.orgId, orgId),
      ),
    )
    .orderBy(whatsappMessages.createdAt);
}

export async function markConversationRead(id: string, orgId: string): Promise<void> {
  await db
    .update(whatsappConversations)
    .set({ unreadCount: 0, updatedAt: new Date() })
    .where(and(eq(whatsappConversations.id, id), eq(whatsappConversations.orgId, orgId)));
}

export async function totalUnread(orgId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${whatsappConversations.unreadCount}), 0)::int` })
    .from(whatsappConversations)
    .where(eq(whatsappConversations.orgId, orgId));
  return row?.total ?? 0;
}

/** Find an existing customer in this org whose phone matches the WhatsApp number. */
export async function findCustomerByPhone(
  orgId: string,
  phone: string,
): Promise<Customer | null> {
  const rows = await db
    .select()
    .from(customers)
    .where(eq(customers.orgId, orgId));
  return rows.find((c) => c.phone && phonesMatch(phone, c.phone)) ?? null;
}

/** Link a conversation to a customer (sets FK + writes audit row). */
export async function linkConversationCustomer(params: {
  orgId: string;
  conversationId: string;
  customerId: string;
  linkedByUserId?: string;
}): Promise<void> {
  await db
    .update(whatsappConversations)
    .set({ customerId: params.customerId, updatedAt: new Date() })
    .where(
      and(
        eq(whatsappConversations.id, params.conversationId),
        eq(whatsappConversations.orgId, params.orgId),
      ),
    );
  await db.insert(whatsappCustomerLinks).values({
    orgId: params.orgId,
    conversationId: params.conversationId,
    customerId: params.customerId,
    linkedByUserId: params.linkedByUserId,
    createdAt: new Date(),
  });
}

/** Create a customer from a conversation and link it (source = whatsapp). */
export async function createCustomerFromConversation(params: {
  orgId: string;
  conversationId: string;
  name: string;
  phone: string;
  linkedByUserId?: string;
}): Promise<Customer> {
  const now = new Date();
  const [customer] = await db
    .insert(customers)
    .values({
      orgId: params.orgId,
      name: params.name,
      phone: params.phone,
      source: "whatsapp",
      address: "Created from WhatsApp conversation",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  await linkConversationCustomer({
    orgId: params.orgId,
    conversationId: params.conversationId,
    customerId: customer.id,
    linkedByUserId: params.linkedByUserId,
  });
  return customer;
}

// ---- Order intents ----

/** Products in a lightweight shape for the order-intent parser. */
export async function getProductsForIntent(orgId: string): Promise<IntentProduct[]> {
  const rows = await db
    .select({
      productId: products.productId,
      name: products.name,
      aliases: products.aliases,
    })
    .from(products)
    .where(eq(products.orgId, orgId));
  return rows.map((r) => ({ productId: r.productId, name: r.name, aliases: r.aliases ?? [] }));
}

export async function createOrderIntent(params: {
  orgId: string;
  conversationId: string;
  messageId?: string;
  customerId?: string | null;
  parsedItems: WhatsappParsedItem[];
  rawText?: string;
  confidence?: number;
  status?: WhatsappOrderIntentStatus;
}): Promise<WhatsappOrderIntent> {
  const now = new Date();
  const [row] = await db
    .insert(whatsappOrderIntents)
    .values({
      orgId: params.orgId,
      conversationId: params.conversationId,
      messageId: params.messageId,
      customerId: params.customerId ?? null,
      parsedItems: params.parsedItems,
      rawText: params.rawText,
      confidenceScore: params.confidence !== undefined ? params.confidence.toFixed(3) : null,
      status: params.status ?? "suggested",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row;
}

export async function listIntentsForConversation(
  conversationId: string,
  orgId: string,
): Promise<WhatsappOrderIntent[]> {
  return db
    .select()
    .from(whatsappOrderIntents)
    .where(
      and(
        eq(whatsappOrderIntents.conversationId, conversationId),
        eq(whatsappOrderIntents.orgId, orgId),
      ),
    )
    .orderBy(desc(whatsappOrderIntents.createdAt));
}

export async function getOrderIntent(
  id: string,
  orgId: string,
): Promise<WhatsappOrderIntent | null> {
  const [row] = await db
    .select()
    .from(whatsappOrderIntents)
    .where(and(eq(whatsappOrderIntents.id, id), eq(whatsappOrderIntents.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

export async function updateOrderIntent(
  id: string,
  orgId: string,
  patch: { status?: WhatsappOrderIntentStatus; draftOrderId?: string | null; customerId?: string | null },
): Promise<void> {
  await db
    .update(whatsappOrderIntents)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(whatsappOrderIntents.id, id), eq(whatsappOrderIntents.orgId, orgId)));
}

/** Validate an order belongs to the org (for attach-order). */
export async function getOrderForOrg(orderId: string, orgId: string): Promise<Order | null> {
  const [row] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.orgId, orgId)))
    .limit(1);
  return row ?? null;
}
