import { describe, it, expect } from "vitest";
import { parseWebhookPayload } from "../whatsapp/parse";

function textPayload() {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "447805597760", phone_number_id: "PNID1" },
              contacts: [{ profile: { name: "Ada Lovelace" }, wa_id: "447700900001" }],
              messages: [
                {
                  from: "447700900001",
                  id: "wamid.AAA",
                  timestamp: "1700000000",
                  type: "text",
                  text: { body: "Can I get 2 boxes please" },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe("parseWebhookPayload", () => {
  it("parses an inbound text message with profile name and routing id", () => {
    const parsed = parseWebhookPayload(textPayload());
    expect(parsed.messages).toHaveLength(1);
    const m = parsed.messages[0];
    expect(m.phoneNumberId).toBe("PNID1");
    expect(m.waId).toBe("447700900001");
    expect(m.profileName).toBe("Ada Lovelace");
    expect(m.whatsappMessageId).toBe("wamid.AAA");
    expect(m.messageType).toBe("text");
    expect(m.body).toBe("Can I get 2 boxes please");
    expect(m.timestamp?.getTime()).toBe(1700000000 * 1000);
  });

  it("parses media messages with id, mime type and caption", () => {
    const payload = textPayload();
    payload.entry[0].changes[0].value.messages = [
      {
        from: "447700900001",
        id: "wamid.IMG",
        timestamp: "1700000100",
        type: "image",
        image: { id: "media-123", mime_type: "image/jpeg", caption: "the receipt" },
      },
    ] as any;
    const parsed = parseWebhookPayload(payload);
    const m = parsed.messages[0];
    expect(m.messageType).toBe("image");
    expect(m.mediaId).toBe("media-123");
    expect(m.mediaMimeType).toBe("image/jpeg");
    expect(m.body).toBe("the receipt");
  });

  it("maps unknown message types to 'unknown'", () => {
    const payload = textPayload();
    payload.entry[0].changes[0].value.messages = [
      { from: "447700900001", id: "wamid.X", timestamp: "1", type: "sticker" },
    ] as any;
    const parsed = parseWebhookPayload(payload);
    expect(parsed.messages[0].messageType).toBe("unknown");
  });

  it("parses status updates", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA",
          changes: [
            {
              value: {
                metadata: { phone_number_id: "PNID1" },
                statuses: [
                  { id: "wamid.OUT", status: "delivered", timestamp: "1700000200", recipient_id: "447700900001" },
                ],
              },
            },
          ],
        },
      ],
    };
    const parsed = parseWebhookPayload(payload);
    expect(parsed.statuses).toHaveLength(1);
    expect(parsed.statuses[0].status).toBe("delivered");
    expect(parsed.statuses[0].whatsappMessageId).toBe("wamid.OUT");
  });

  it("returns empty results for malformed payloads without throwing", () => {
    expect(parseWebhookPayload(null)).toEqual({ messages: [], statuses: [] });
    expect(parseWebhookPayload({})).toEqual({ messages: [], statuses: [] });
    expect(parseWebhookPayload({ entry: "nope" })).toEqual({ messages: [], statuses: [] });
    expect(parseWebhookPayload({ entry: [{ changes: [{ value: {} }] }] })).toEqual({
      messages: [],
      statuses: [],
    });
  });

  it("skips messages missing id or sender", () => {
    const payload = textPayload();
    payload.entry[0].changes[0].value.messages = [
      { from: "447700900001", timestamp: "1", type: "text", text: { body: "no id" } },
    ] as any;
    expect(parseWebhookPayload(payload).messages).toHaveLength(0);
  });
});
