import { describe, expect, it } from "vitest";
import { orderDraftPayloadSchema } from "./orderDraft";

const productId = "11111111-1111-4111-8111-111111111111";

function payload(extra: Record<string, unknown> = {}) {
  return {
    lines: [{ productId, quantity: 2, customPrice: 3.5 }],
    customerId: null,
    paymentMethod: "cash",
    personalUseReason: "",
    splitPayment: false,
    tenderLegs: [],
    orderDate: "2026-10-08",
    fulfilmentMethod: "collection",
    delivery: { address: "", postcode: "", notes: "", saveAsCustomerAddress: false },
    deliveryFeeInput: null,
    promoCode: "",
    redeemPoints: 0,
    orderExpenses: [],
    emailReceipt: false,
    channel: "pos",
    dueTime: "14:30",
    dueMinutes: null,
    dueTouched: true,
    assigneeUserId: "",
    label: "Walk-in",
    ...extra,
  };
}

describe("order draft payload", () => {
  it("keeps the till fields and drops a gift card code", () => {
    const parsed = orderDraftPayloadSchema.parse(payload({ giftCardCode: "SECRET-CODE" }));
    expect(parsed.lines).toEqual([{ productId, quantity: 2, customPrice: 3.5 }]);
    expect(parsed).not.toHaveProperty("giftCardCode");
  });

  it("refuses a line with no product", () => {
    const result = orderDraftPayloadSchema.safeParse(payload({ lines: [{ productId: "nope", quantity: 1, customPrice: 1 }] }));
    expect(result.success).toBe(false);
  });
});
