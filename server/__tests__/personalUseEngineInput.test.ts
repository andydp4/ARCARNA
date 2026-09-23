/**
 * Personal use was refused at the till with a raw "invalid enum value" error:
 * the order route accepts paymentMethod "personal_use", but the domain
 * engine's PlaceOrderInput did not list it, so engine.placeOrder threw before
 * the sale existed.
 */
import { describe, expect, it } from "vitest";
import { PlaceOrderInput } from "../../packages/domain/src/schemas";

const base = {
  lines: [{ productId: "11111111-1111-1111-1111-111111111111", quantity: 1, unitPrice: 2.5 }],
};

describe("order engine input", () => {
  it("accepts a personal-use sale", () => {
    expect(PlaceOrderInput.safeParse({ ...base, paymentMethod: "personal_use" }).success).toBe(true);
  });

  it("still refuses a payment method nobody offers", () => {
    expect(PlaceOrderInput.safeParse({ ...base, paymentMethod: "bitcoin" }).success).toBe(false);
  });
});
