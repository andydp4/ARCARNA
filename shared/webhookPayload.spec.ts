import { describe, expect, it } from "vitest";
import { orderIdInPayload, orgIdInPayload, WEBHOOK_EVENT_TYPES, webhookPayloadFor } from "./webhookPayload";

describe("outbound webhooks send an explicit payload per event (CMP-14)", () => {
  const outbox = {
    order: {
      orderId: "o1",
      status: "pending",
      customerId: "c1",
      total: 12.5,
      paymentMethod: "cash",
      sendEmailReceipt: true,
      // Fields a future worker might add to the outbox payload: never forwarded.
      customerName: "Jane Smith",
      customerPhone: "07700 904821",
      deliveryAddress: "1 High Street",
      items: [{ lineId: "l1", productId: "p1", qty: 2, unitPrice: 6.25, lineTotal: 12.5, costPrice: 3 }],
    },
    sendEmailReceipt: true,
  };

  it("an order carries ids, status, money and lines — nothing about the person", () => {
    const body = webhookPayloadFor("OrderCreated", outbox)!;
    expect(body).toEqual({
      orderId: "o1",
      status: "pending",
      customerId: "c1",
      total: 12.5,
      paymentMethod: "cash",
      items: [{ productId: "p1", qty: 2, unitPrice: 6.25, lineTotal: 12.5 }],
    });
    const text = JSON.stringify(body);
    for (const leaked of ["Jane", "07700", "High Street", "sendEmailReceipt", "costPrice", "lineId"]) {
      expect(text, leaked).not.toContain(leaked);
    }
  });

  it("a refund names products and quantities only", () => {
    expect(
      webhookPayloadFor("RefundIssued", {
        refundId: "r1",
        orderId: "o1",
        customerId: "c1",
        total: 5,
        orderTotal: 12.5,
        pointsToReverse: 5,
        method: "cash",
        lines: [{ lineId: "l1", qty: 1, productId: "p1", sku: "SKU" }],
      }),
    ).toEqual({ refundId: "r1", orderId: "o1", total: 5, method: "cash", lines: [{ productId: "p1", qty: 1 }] });
  });

  it("staff and bookkeeping events are not offered at all", () => {
    expect(webhookPayloadFor("PersonalUseRecorded", { reason: "lunch" })).toBeNull();
    expect(webhookPayloadFor("ExpenseLogged", { amount: 5 })).toBeNull();
    expect(webhookPayloadFor("SomethingNew", {})).toBeNull();
    expect(WEBHOOK_EVENT_TYPES).not.toContain("PersonalUseRecorded");
    expect(WEBHOOK_EVENT_TYPES).toContain("OrderCreated");
  });

  it("finds the org or the order the event is about", () => {
    expect(orgIdInPayload({ orgId: "org1" })).toBe("org1");
    expect(orgIdInPayload({ order: { orgId: "org2" } })).toBe("org2");
    expect(orgIdInPayload(outbox)).toBeNull();
    expect(orderIdInPayload(outbox)).toBe("o1");
    expect(orderIdInPayload({ orderId: "o2", from: "a", to: "b" })).toBe("o2");
  });
});
