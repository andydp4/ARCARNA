import { describe, expect, it } from "vitest";
import { readSaleIssuePayload, saleIssueLinesTotal } from "../saleIssueDraft";

describe("a refused sale opened in the till", () => {
  const payload = {
    clientOrderId: "ref-12345678",
    lines: [
      { productId: "p1", quantity: 2, unitPrice: 4.5 },
      { productId: "p2", quantity: 0.4, unitPrice: 10 },
      { productId: 7, quantity: 1, unitPrice: 1 },
    ],
    paymentMethod: "split",
    payments: [
      { method: "cash", amount: 5 },
      { method: "tick", amount: 8 },
    ],
    customerId: "c1",
    fulfilmentMethod: "delivery",
    channel: "phone",
    giftCardCode: "GC-1",
    redeemPoints: 100,
    expenses: [{ category: "shipping", description: "taxi", amount: 3 }],
  };

  it("puts back the lines, customer, split and fulfilment", () => {
    const sale = readSaleIssuePayload(payload);
    expect(sale.lines).toEqual([
      { productId: "p1", quantity: 2, unitPrice: 4.5 },
      { productId: "p2", quantity: 0.4, unitPrice: 10 },
    ]);
    expect(sale.customerId).toBe("c1");
    expect(sale.payments).toEqual([
      { method: "cash", amount: 5 },
      { method: "tick", amount: 8 },
    ]);
    expect(sale.fulfilmentMethod).toBe("delivery");
    expect(sale.channel).toBe("phone");
    expect(sale.expenses).toHaveLength(1);
  });

  it("leaves gift cards and points to be applied again, and says so", () => {
    expect(readSaleIssuePayload(payload).dropped).toEqual(["gift card", "points"]);
  });

  it("totals the lines for the list", () => {
    expect(saleIssueLinesTotal(payload)).toBe(13);
  });

  it("copes with a payload with nothing usable in it", () => {
    const sale = readSaleIssuePayload({});
    expect(sale.lines).toEqual([]);
    expect(sale.payments).toBeNull();
    expect(sale.fulfilmentMethod).toBe("collection");
  });
});
