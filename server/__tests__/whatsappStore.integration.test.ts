/**
 * Integration test for the WhatsApp ingestion path against a real Postgres DB.
 * Excluded from the unit run when DATABASE_URL is unset (see vitest.config.ts),
 * mirroring orderOutboxAtomicity.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import {
  organizations,
  customers,
  products,
  whatsappAccounts,
  whatsappConversations,
  whatsappMessages,
  whatsappCustomerLinks,
  whatsappOrderIntents,
} from "@shared/schema";
import { ingestWebhook } from "../whatsapp/service";
import * as store from "../whatsapp/store";

const PNID = `pnid-test-${Date.now()}`;
const WA_ID = "447700900123";
const CUSTOMER_PHONE = "07700900123";

let orgId: string;
let accountId: string;

function payload(messageId: string, body: string) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_TEST",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "447805597760", phone_number_id: PNID },
              contacts: [{ profile: { name: "Test Buyer" }, wa_id: WA_ID }],
              messages: [
                { from: WA_ID, id: messageId, timestamp: "1700000000", type: "text", text: { body } },
              ],
            },
          },
        ],
      },
    ],
  };
}

beforeAll(async () => {
  const [org] = await db.insert(organizations).values({ name: "WA Test Org" }).returning();
  orgId = org.id;
  const [account] = await db
    .insert(whatsappAccounts)
    .values({ orgId, phoneNumber: "+447805597760", phoneNumberId: PNID, status: "connected" })
    .returning();
  accountId = account.id;
  await db
    .insert(products)
    .values({
      orgId,
      name: "Coke",
      productId: `COKE-${Date.now()}`,
      defaultSalePrice: "1.50",
      aliases: ["coke"],
    });
  await db.insert(customers).values({ orgId, name: "Test Buyer", phone: CUSTOMER_PHONE });
});

afterAll(async () => {
  // Children first (FKs without cascade to org for customers/products).
  await db.delete(whatsappOrderIntents).where(eq(whatsappOrderIntents.orgId, orgId));
  await db.delete(whatsappCustomerLinks).where(eq(whatsappCustomerLinks.orgId, orgId));
  await db.delete(whatsappMessages).where(eq(whatsappMessages.orgId, orgId));
  await db.delete(whatsappConversations).where(eq(whatsappConversations.orgId, orgId));
  await db.delete(whatsappAccounts).where(eq(whatsappAccounts.orgId, orgId));
  await db.delete(products).where(eq(products.orgId, orgId));
  await db.delete(customers).where(eq(customers.orgId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
});

describe("whatsapp ingestion (real DB)", () => {
  it("stores message, auto-links customer, and creates an order intent", async () => {
    const summary = await ingestWebhook(payload("wamid.INT-1", "can I get 2 cokes"));
    expect(summary.stored).toBe(1);
    expect(summary.autoLinked).toBe(1);
    expect(summary.orderIntents).toBe(1);

    const conversations = await store.listConversations(orgId);
    expect(conversations).toHaveLength(1);
    expect(conversations[0].customerId).toBeTruthy();
    expect(conversations[0].customerName).toBe("Test Buyer");

    const messages = await store.listMessages(conversations[0].id, orgId);
    expect(messages).toHaveLength(1);
    expect(messages[0].direction).toBe("inbound");

    const intents = await store.listIntentsForConversation(conversations[0].id, orgId);
    expect(intents).toHaveLength(1);
    const cokeLine = intents[0].parsedItems.find((i) => i.name === "Coke");
    expect(cokeLine?.quantity).toBe(2);
  });

  it("is idempotent for a duplicate whatsapp_message_id", async () => {
    const first = await ingestWebhook(payload("wamid.DUP", "hello again"));
    const second = await ingestWebhook(payload("wamid.DUP", "hello again"));
    expect(first.stored + second.stored).toBe(1);
    expect(second.duplicates).toBe(1);

    const conversations = await store.listConversations(orgId);
    const convo = conversations[0];
    const messages = await store.listMessages(convo.id, orgId);
    // 2 distinct inbound messages total (INT-1 + DUP), not 3.
    expect(messages.filter((m) => m.direction === "inbound")).toHaveLength(2);
  });

  it("seeds and lists templates", async () => {
    await store.seedDefaultTemplates(orgId);
    const templates = await store.listTemplates(orgId);
    expect(templates.find((t) => t.templateName === "order_confirmation")).toBeTruthy();
  });
});
