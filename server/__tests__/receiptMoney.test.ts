import { describe, expect, it } from "vitest";
import { receiptMoney } from "../services/receiptMoney";

const items = [{ productName: "Widget", quantity: 2, unitPrice: "25.00", totalPrice: "50.00" }];

describe("an emailed receipt's money", () => {
  it("puts the delivery fee on its own line (v1.2.1)", () => {
    const m = receiptMoney({ total: "53.50", vatAmount: "0.00", deliveryFee: "3.50" }, items, "Delivery fee");
    expect(m.lines).toEqual([
      { name: "Widget", qty: 2, unitPrice: 25, lineTotal: 50 },
      { name: "Delivery fee", qty: 1, unitPrice: 3.5, lineTotal: 3.5 },
    ]);
    expect(m.total).toBe(53.5);
  });

  it("uses the org's name for the fee", () => {
    const m = receiptMoney({ total: "54.00", vatAmount: "0.00", deliveryFee: "4.00" }, items, "Van charge");
    expect(m.lines[1].name).toBe("Van charge");
  });

  it("claims no VAT on a sale that charged none (it used to read 20% off every total)", () => {
    const m = receiptMoney({ total: "53.50", vatAmount: "0.00", deliveryFee: "3.50" }, items, "Delivery fee");
    expect(m.tax).toBe(0);
    expect(m.subtotal).toBe(53.5);
  });

  it("shows the VAT the sale was charged", () => {
    const m = receiptMoney({ total: "64.20", vatAmount: "10.70", deliveryFee: "3.50" }, items, "Delivery fee");
    expect(m.tax).toBe(10.7);
    expect(m.subtotal).toBe(53.5);
  });

  it("keeps the old estimate, and no fee line, for an order from before either was recorded", () => {
    const m = receiptMoney({ total: "60.00", vatAmount: null, deliveryFee: null }, items, "Delivery fee");
    expect(m.tax).toBe(10);
    expect(m.lines).toHaveLength(1);
  });
});
