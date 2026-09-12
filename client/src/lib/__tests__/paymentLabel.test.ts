/**
 * The stored value for a credit sale is still literally "tick" — it is a
 * database value on every historic and current order, not just a label, and
 * changing it is a data migration, not a rename. Every place that DISPLAYS a
 * payment method has to translate it, or the word "tick" resurfaces on a
 * screen a member of staff reads (the Operations Centre board, invoices,
 * insights).
 *
 * Moved here with the function itself in N1 of the Operations Centre work,
 * out of `components/__tests__/ordersRow.test.ts` — that file goes when Open
 * Orders does (N4b), and these assertions outlive it.
 */
import { describe, expect, it } from "vitest";
import { formatPaymentLabel } from "../paymentLabel";

describe("payment method labels", () => {
  it("shows a credit sale as Credit, never as tick", () => {
    expect(formatPaymentLabel("tick")).toBe("Credit");
    expect(formatPaymentLabel("TICK")).toBe("Credit");
  });

  it("capitalises everything else consistently", () => {
    expect(formatPaymentLabel("cash")).toBe("Cash");
    expect(formatPaymentLabel("card")).toBe("Card");
    expect(formatPaymentLabel("transfer")).toBe("Transfer");
  });

  it("turns hyphens and underscores into spaces before capitalising", () => {
    expect(formatPaymentLabel("personal_use")).toBe("Personal use");
    expect(formatPaymentLabel("gift-card")).toBe("Gift card");
  });

  it("shows a dash for no method at all, rather than an empty cell", () => {
    expect(formatPaymentLabel("")).toBe("—");
  });
});
