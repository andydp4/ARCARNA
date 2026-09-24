import { describe, expect, it } from "vitest";
import { invoiceAmounts, storedInvoiceSubtotal } from "./invoiceRules";

describe("an invoice with a delivery fee (v1.2.1)", () => {
  it("shows the fee as its own line and the figures add up to the total", () => {
    const a = invoiceAmounts({
      total: 64.2,
      vatAmount: 10.7,
      vatRate: 20,
      orgVatRate: 20,
      subtotal: 50,
      tierDiscount: 0,
      promoDiscount: 0,
      pointsDiscount: 0,
      deliveryFee: 3.5,
    });
    expect(a).toEqual({ subtotal: 50, discount: 0, tax: 10.7, vatRate: 20, pointsDiscount: 0, deliveryFee: 3.5 });
  });

  it("stores goods and fee together as the row's subtotal, so the row adds up on its own", () => {
    expect(storedInvoiceSubtotal({ subtotal: 50, deliveryFee: 3.5 })).toBe(53.5);
    expect(storedInvoiceSubtotal({ subtotal: 50, deliveryFee: 0 })).toBe(50);
  });

  it("an order with no fee is shown exactly as before", () => {
    const a = invoiceAmounts({ total: 50, vatAmount: 0, vatRate: 0, orgVatRate: 0, subtotal: 50 });
    expect(a).toEqual({ subtotal: 50, discount: 0, tax: 0, vatRate: 0, pointsDiscount: 0, deliveryFee: 0 });
  });
});
