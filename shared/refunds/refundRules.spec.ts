import { describe, expect, it } from "vitest";
import { refundCashOut, refundLineAmounts, resolveRefundTender } from "./refundRules";

describe("refund amounts share the sale's discount", () => {
  it("gives back what the customer paid for the item, not its list price", () => {
    // 2 x £25 with 10% off, settled at £45: one item cost the customer £22.50.
    const r = refundLineAmounts({
      lines: [{ orderLineId: "l1", qty: 1, unitPrice: 25 }],
      lineValue: 50,
      settled: 45,
      priorRefunded: 0,
      refundsEverything: false,
    });
    expect(r.total).toBe(22.5);
  });

  it("lets the rest of the sale be refunded, and never more than it was settled at", () => {
    const second = refundLineAmounts({
      lines: [{ orderLineId: "l1", qty: 1, unitPrice: 25 }],
      lineValue: 50,
      settled: 45,
      priorRefunded: 22.5,
      refundsEverything: true,
    });
    expect(second.total).toBe(22.5);
  });

  it("puts the rounding on the last refund so a whole sale comes back to the penny", () => {
    // 3 x £10 settled at £20: thirds do not divide.
    const one = refundLineAmounts({ lines: [{ orderLineId: "l", qty: 1, unitPrice: 10 }], lineValue: 30, settled: 20, priorRefunded: 0, refundsEverything: false });
    const two = refundLineAmounts({ lines: [{ orderLineId: "l", qty: 1, unitPrice: 10 }], lineValue: 30, settled: 20, priorRefunded: one.total, refundsEverything: false });
    const three = refundLineAmounts({ lines: [{ orderLineId: "l", qty: 1, unitPrice: 10 }], lineValue: 30, settled: 20, priorRefunded: one.total + two.total, refundsEverything: true });
    expect(Math.round((one.total + two.total + three.total) * 100) / 100).toBe(20);
  });
});

describe("refunds go back the way the money came in", () => {
  const base = { refundTotal: 25, tabOutstanding: 0, tabPaymentMethods: [] as string[] };

  it("sends a card sale's refund back to the card, not out of the drawer", () => {
    const t = resolveRefundTender({ ...base, requested: "original", legs: [{ method: "card", amount: 50 }], paymentMethod: "card" });
    expect(t).toMatchObject({ ok: true, method: "card", creditAmount: 0 });
    expect(refundCashOut({ refundMethod: "card", total: 25 })).toBe(0);
  });

  it("keeps a cash sale's refund as cash from the drawer", () => {
    const t = resolveRefundTender({ ...base, requested: "original", legs: [{ method: "cash", amount: 50 }], paymentMethod: "cash" });
    expect(t).toMatchObject({ ok: true, method: "original" });
    expect(refundCashOut({ refundMethod: "original", total: 25 })).toBe(25);
  });

  it("takes an unpaid tab sale's refund off the tab, paying nothing out", () => {
    const t = resolveRefundTender({ ...base, requested: "original", legs: [{ method: "tick", amount: 25 }], paymentMethod: "tick", tabOutstanding: 25 });
    expect(t).toMatchObject({ ok: true, method: "credit", creditAmount: 25, paidOut: 0 });
  });

  it("takes the tab first even when cash is asked for, and hands back only what was repaid", () => {
    // £25 on the tab, £10 repaid in cash, £15 still owed.
    const t = resolveRefundTender({ ...base, requested: "cash", legs: [{ method: "tick", amount: 25 }], paymentMethod: "tick", tabOutstanding: 15, tabPaymentMethods: ["cash"] });
    expect(t).toMatchObject({ ok: true, method: "cash", creditAmount: 15, paidOut: 10 });
    expect(refundCashOut({ refundMethod: "cash", total: 25, creditAmount: 15 })).toBe(10);
  });

  it("asks which way when the sale was paid more than one way", () => {
    const t = resolveRefundTender({ ...base, requested: "original", legs: [{ method: "cash", amount: 20 }, { method: "card", amount: 30 }], paymentMethod: "split" });
    expect(t.ok).toBe(false);
  });
});
