import { describe, expect, it } from "vitest";
import {
  checkTillCreditPayment,
  customerCreditNotice,
  formatCreditDate,
  summariseCustomerCredit,
} from "./customerCredit";
import { normaliseUsageEvent, usageBatchSchema } from "./usage";

/** "This customer already owes" at order start, and Take a payment (v1.2.1 credit): the shared rules. */

describe("what a customer owes", () => {
  it("totals the open tabs, counts them and finds the oldest", () => {
    const s = summariseCustomerCredit("c1", [
      { amountOutstanding: "12.50", givenOn: "2026-09-10" },
      { amountOutstanding: "30.00", givenOn: "2026-08-02" },
      { amountOutstanding: 0.1, givenOn: "2026-09-20" },
    ]);
    expect(s).toEqual({ customerId: "c1", owed: 42.6, tabs: 3, oldestGivenOn: "2026-08-02" });
  });

  it("leaves out a tab with nothing left on it", () => {
    const s = summariseCustomerCredit("c1", [
      { amountOutstanding: "0.00", givenOn: "2026-01-01" },
      { amountOutstanding: "5", givenOn: "2026-09-01" },
    ]);
    expect(s).toEqual({ customerId: "c1", owed: 5, tabs: 1, oldestGivenOn: "2026-09-01" });
  });

  it("is nothing for a customer with no tabs", () => {
    expect(summariseCustomerCredit("c1", [])).toEqual({ customerId: "c1", owed: 0, tabs: 0, oldestGivenOn: null });
  });
});

describe("the notice", () => {
  it("says how much, how many tabs and the oldest date, and reminds staff to record a payment", () => {
    const n = customerCreditNotice({ owed: 42.6, tabs: 3, oldestGivenOn: "2026-08-02" });
    expect(n?.headline).toBe("This customer already owes £42.60");
    expect(n?.detail).toBe("On 3 tabs, the oldest from 2 Aug 2026.");
    expect(n?.reminder).toMatch(/record it against their credit with Take a payment/);
    expect(n?.reminder).toMatch(/sale can go ahead/);
  });

  it("reads naturally for one tab", () => {
    expect(customerCreditNotice({ owed: 5, tabs: 1, oldestGivenOn: "2026-09-03" })?.detail).toBe("On 1 tab, from 3 Sept 2026.");
  });

  it("shows nothing when nothing is owed", () => {
    expect(customerCreditNotice({ owed: 0, tabs: 0, oldestGivenOn: null })).toBeNull();
    expect(customerCreditNotice(null)).toBeNull();
  });

  it("formats a calendar date without a time zone", () => {
    expect(formatCreditDate("2026-12-31")).toBe("31 Dec 2026");
    expect(formatCreditDate("nonsense")).toBe("");
    expect(formatCreditDate(null)).toBe("");
  });
});

describe("a payment taken at the till", () => {
  it("takes cash or card, part or all of what is owed", () => {
    expect(checkTillCreditPayment({ amount: 10, method: "cash" }, 42.6)).toEqual({ ok: true, amount: 10, method: "cash" });
    expect(checkTillCreditPayment({ amount: "42.60", method: "Card" }, 42.6)).toEqual({ ok: true, amount: 42.6, method: "card" });
  });

  it("refuses more than is owed", () => {
    const r = checkTillCreditPayment({ amount: 42.61, method: "cash" }, 42.6);
    expect(r).toMatchObject({ ok: false, status: 400, code: "CREDIT_OVERPAYMENT" });
  });

  it("refuses zero, negative, fractions of a penny and nonsense", () => {
    for (const amount of [0, -5, 1.005, "abc", "", null, undefined, Infinity]) {
      expect(checkTillCreditPayment({ amount, method: "cash" }, 50), String(amount)).toMatchObject({ ok: false, code: "CREDIT_AMOUNT_INVALID" });
    }
  });

  it("needs the method said, and it is cash or card", () => {
    expect(checkTillCreditPayment({ amount: 5 }, 50)).toMatchObject({ ok: false, code: "CREDIT_METHOD_REQUIRED" });
    expect(checkTillCreditPayment({ amount: 5, method: "transfer" }, 50)).toMatchObject({ ok: false, code: "CREDIT_METHOD_INVALID" });
    expect(checkTillCreditPayment({ amount: 5, method: "tick" }, 50)).toMatchObject({ ok: false, code: "CREDIT_METHOD_INVALID" });
  });

  it("is today's: the till never backdates", () => {
    expect(checkTillCreditPayment({ amount: 5, method: "cash", paidOn: "2026-09-01" }, 50)).toMatchObject({
      ok: false,
      code: "CREDIT_BACKDATE_AT_TILL",
    });
  });

  it("has nothing to pay when nothing is owed", () => {
    expect(checkTillCreditPayment({ amount: 5, method: "cash" }, 0)).toMatchObject({ ok: false, status: 409, code: "CREDIT_NOTHING_OWED" });
  });
});

describe("the usage record", () => {
  const now = new Date("2026-09-24T12:00:00Z");
  it("keeps the notice shown and the payment taken, and nothing else about them", () => {
    const at = now.toISOString();
    for (const step of ["shown", "paid"] as const) {
      const row = normaliseUsageEvent({ kind: "credit", at, screen: "/create-order", step }, now);
      expect(row).toMatchObject({ kind: "credit", label: step, screen: "/create-order" });
    }
  });

  it("refuses a credit event carrying anything more", () => {
    const at = now.toISOString();
    const batch = (event: Record<string, unknown>) =>
      usageBatchSchema.safeParse({ deviceKey: "abcdefgh1234", events: [event] }).success;
    expect(batch({ kind: "credit", at, screen: "/pos", step: "shown" })).toBe(true);
    expect(batch({ kind: "credit", at, screen: "/pos", step: "owed" })).toBe(false);
    expect(batch({ kind: "credit", at, screen: "/pos", step: "paid", amount: 12 })).toBe(false);
    expect(batch({ kind: "credit", at, screen: "/pos", step: "paid", customerId: "x" })).toBe(false);
  });
});
