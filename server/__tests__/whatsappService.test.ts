import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the data-access layer so the service can be tested without a database
// (store.ts imports server/db which requires DATABASE_URL at module load).
vi.mock("../whatsapp/store", () => ({
  getAccountByPhoneNumberId: vi.fn(),
  touchAccountWebhook: vi.fn(),
  findOrCreateConversation: vi.fn(),
  insertInboundMessage: vi.fn(),
  bumpConversationInbound: vi.fn(),
  findCustomerByPhone: vi.fn(),
  linkConversationCustomer: vi.fn(),
  applyStatusUpdate: vi.fn(),
}));

import * as store from "../whatsapp/store";
import { ingestWebhook, isWithinServiceWindow, previewFor } from "../whatsapp/service";

const mocked = store as unknown as Record<string, ReturnType<typeof vi.fn>>;

function messagePayload(id = "wamid.AAA", body = "hello") {
  return {
    entry: [
      {
        id: "WABA",
        changes: [
          {
            value: {
              metadata: { phone_number_id: "PNID1" },
              contacts: [{ profile: { name: "Ada" }, wa_id: "447805597760" }],
              messages: [{ from: "447805597760", id, timestamp: "1700000000", type: "text", text: { body } }],
            },
          },
        ],
      },
    ],
  };
}

const account = { id: "acc-1", orgId: "org-1" };
const conversation = { id: "conv-1", customerId: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocked.getAccountByPhoneNumberId.mockResolvedValue(account);
  mocked.findOrCreateConversation.mockResolvedValue(conversation);
  mocked.insertInboundMessage.mockResolvedValue({ id: "msg-1" });
  mocked.findCustomerByPhone.mockResolvedValue(null);
});

describe("service window", () => {
  it("is open within 24h of last inbound", () => {
    expect(isWithinServiceWindow(new Date(Date.now() - 60_000))).toBe(true);
  });
  it("is closed after 24h", () => {
    expect(isWithinServiceWindow(new Date(Date.now() - 25 * 60 * 60 * 1000))).toBe(false);
  });
  it("is closed with no inbound", () => {
    expect(isWithinServiceWindow(null)).toBe(false);
  });
});

describe("previewFor", () => {
  it("uses the body when present", () => {
    expect(previewFor("text", "hi there")).toBe("hi there");
  });
  it("labels media without a caption", () => {
    expect(previewFor("image")).toBe("[image]");
  });
});

describe("ingestWebhook", () => {
  it("stores a new inbound message and bumps the conversation", async () => {
    const summary = await ingestWebhook(messagePayload());
    expect(summary.received).toBe(1);
    expect(summary.stored).toBe(1);
    expect(summary.duplicates).toBe(0);
    expect(mocked.insertInboundMessage).toHaveBeenCalledTimes(1);
    expect(mocked.bumpConversationInbound).toHaveBeenCalledTimes(1);
  });

  it("auto-links to an existing customer matched by phone", async () => {
    mocked.findCustomerByPhone.mockResolvedValue({ id: "cust-9" });
    const summary = await ingestWebhook(messagePayload());
    expect(summary.autoLinked).toBe(1);
    expect(mocked.linkConversationCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", conversationId: "conv-1", customerId: "cust-9" }),
    );
  });

  it("leaves the conversation unlinked when no customer matches", async () => {
    const summary = await ingestWebhook(messagePayload());
    expect(summary.autoLinked).toBe(0);
    expect(mocked.linkConversationCustomer).not.toHaveBeenCalled();
  });

  it("treats a duplicate whatsapp_message_id as idempotent (no bump)", async () => {
    mocked.insertInboundMessage.mockResolvedValue(null); // conflict → already stored
    const summary = await ingestWebhook(messagePayload());
    expect(summary.received).toBe(1);
    expect(summary.stored).toBe(0);
    expect(summary.duplicates).toBe(1);
    expect(mocked.bumpConversationInbound).not.toHaveBeenCalled();
    expect(mocked.linkConversationCustomer).not.toHaveBeenCalled();
  });

  it("skips messages for an unknown phone_number_id (not our number)", async () => {
    mocked.getAccountByPhoneNumberId.mockResolvedValue(null);
    const summary = await ingestWebhook(messagePayload());
    expect(summary.skippedNoAccount).toBe(1);
    expect(summary.stored).toBe(0);
    expect(mocked.insertInboundMessage).not.toHaveBeenCalled();
  });

  it("applies status updates keyed by message id", async () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "PNID1" },
                statuses: [{ id: "wamid.OUT", status: "delivered", timestamp: "1700000200" }],
              },
            },
          ],
        },
      ],
    };
    const summary = await ingestWebhook(payload);
    expect(summary.statusUpdates).toBe(1);
    expect(mocked.applyStatusUpdate).toHaveBeenCalledWith("org-1", "wamid.OUT", "delivered");
  });
});
