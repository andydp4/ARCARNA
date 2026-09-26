import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MAX_SALE_AMOUNT, plainValidationMessage, saleTooLargeMessage } from "./saleLimits";
import { PlaceOrderInput } from "../../packages/domain/src/schemas";

describe("saleTooLargeMessage (E2E-08)", () => {
  it("lets an ordinary sale through", () => {
    expect(saleTooLargeMessage([{ quantity: 2, unitPrice: 3.5 }], 20)).toBeNull();
  });

  it("refuses a line that passes the per-line bounds but cannot be recorded", () => {
    // 9,999 × £999,999: each bound passes, the product overflows numeric(10,2).
    const msg = saleTooLargeMessage([{ quantity: 9999, unitPrice: 999_999 }]);
    expect(msg).toMatch(/^Line 1 comes to £9,998,990,001\.00/);
    expect(msg).toMatch(/Check the quantity and price\.$/);
  });

  it("refuses a sale whose lines fit one by one but not together", () => {
    const line = { quantity: 1, unitPrice: 60_000_000 };
    expect(saleTooLargeMessage([line])).toBeNull();
    expect(saleTooLargeMessage([line, line])).toMatch(/^This sale comes to £120,000,000\.00/);
  });

  it("counts VAT, as the total will", () => {
    expect(saleTooLargeMessage([{ quantity: 1, unitPrice: MAX_SALE_AMOUNT - 1 }], 0)).toBeNull();
    expect(saleTooLargeMessage([{ quantity: 1, unitPrice: MAX_SALE_AMOUNT - 1 }], 20)).not.toBeNull();
  });
});

describe("plainValidationMessage (E2E-09)", () => {
  it("turns a negative quantity into one sentence, not a JSON dump", () => {
    const parsed = PlaceOrderInput.safeParse({
      lines: [{ productId: "p1", quantity: -2, unitPrice: 10 }],
      paymentMethod: "cash",
    });
    expect(parsed.success).toBe(false);
    const msg = plainValidationMessage(parsed.error!);
    expect(msg).not.toMatch(/^\s*[[{]/);
    expect(msg).toMatch(/^Line 1 quantity: /);
  });

  it("names a top-level field", () => {
    const parsed = z.object({ customerId: z.string().uuid() }).safeParse({ customerId: "x" });
    expect(plainValidationMessage(parsed.error!)).toMatch(/^Customer: /);
  });
});
