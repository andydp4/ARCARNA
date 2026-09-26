import { describe, expect, it } from "vitest";
import {
  CARD_LINK_MAX_MINUTES,
  CARD_LINK_MIN_MINUTES,
  cardLinkSaleRefusal,
  clampLinkMinutes,
  isPaidLeg,
  paymentMethodLabel,
  sessionMismatch,
  toMinorUnits,
  type CardLinkSaleInput,
} from "./cardLink";
import { buildZReport } from "../reports/zReport";
import { buildCashierShiftBalanceSheet } from "../reports/cashierShiftReport";
import { ACCESS_POLICY, isAtLeast } from "../accessPolicy";
import { SIGNAL_ROUTES } from "../signals";

const base: CardLinkSaleInput = {
  paymentMethod: "card_link",
  legs: null,
  configured: true,
  offline: false,
  backdated: false,
  usesGiftCard: false,
  remainderPaymentMethod: null,
  isPersonalUse: false,
};

describe("cardLinkSaleRefusal", () => {
  it("lets a live card-link sale through, and ignores sales that do not use it", () => {
    expect(cardLinkSaleRefusal(base)).toBeNull();
    expect(cardLinkSaleRefusal({ ...base, paymentMethod: "cash", configured: false, offline: true })).toBeNull();
  });

  it("refuses when Stripe is not set up, offline, backdated or with a gift card", () => {
    expect(cardLinkSaleRefusal({ ...base, configured: false })).toMatch(/not set up/);
    expect(cardLinkSaleRefusal({ ...base, offline: true })).toMatch(/connection/);
    expect(cardLinkSaleRefusal({ ...base, backdated: true })).toMatch(/past/);
    expect(cardLinkSaleRefusal({ ...base, paymentMethod: "gift_card", usesGiftCard: true, remainderPaymentMethod: "card_link" })).toMatch(
      /gift card/,
    );
  });

  it("allows one card-link part of a split, of at least 30p", () => {
    const split = (legs: CardLinkSaleInput["legs"]) => cardLinkSaleRefusal({ ...base, paymentMethod: "split", legs });
    expect(split([{ method: "cash", amount: 10 }, { method: "card_link", amount: 15 }])).toBeNull();
    expect(split([{ method: "card_link", amount: 5 }, { method: "card_link", amount: 5 }])).toMatch(/one part/);
    expect(split([{ method: "cash", amount: 10 }, { method: "card_link", amount: 0.2 }])).toMatch(/at least/);
  });
});

describe("sessionMismatch", () => {
  const expected = { amount: 19.99, currency: "GBP", orderId: "order-1" };
  it("accepts exactly the leg's amount, in its currency, for its order", () => {
    expect(sessionMismatch(expected, { amountMinor: 1999, currency: "gbp", orderId: "order-1" })).toBeNull();
  });
  it("refuses a different amount, currency or order", () => {
    expect(sessionMismatch(expected, { amountMinor: 1998, currency: "gbp", orderId: "order-1" })).toMatch(/19.98/);
    expect(sessionMismatch(expected, { amountMinor: 1999, currency: "eur", orderId: "order-1" })).toMatch(/EUR/);
    expect(sessionMismatch(expected, { amountMinor: 1999, currency: "gbp", orderId: "order-2" })).toMatch(/different order/);
    expect(sessionMismatch(expected, { amountMinor: null, currency: "gbp", orderId: "order-1" })).not.toBeNull();
  });
});

describe("small rules", () => {
  it("converts to pence without float drift", () => {
    expect(toMinorUnits(19.99)).toBe(1999);
    expect(toMinorUnits(0.3)).toBe(30);
    expect(toMinorUnits(1234.56)).toBe(123456);
  });
  it("keeps link lifetimes within Stripe's 30 minutes to 24 hours", () => {
    expect(clampLinkMinutes(5)).toBe(CARD_LINK_MIN_MINUTES);
    expect(clampLinkMinutes(99999)).toBe(CARD_LINK_MAX_MINUTES);
    expect(clampLinkMinutes(undefined)).toBe(CARD_LINK_MIN_MINUTES);
  });
  it("treats legs without a status (before migration 140) as paid", () => {
    expect(isPaidLeg({})).toBe(true);
    expect(isPaidLeg({ status: "paid" })).toBe(true);
    expect(isPaidLeg({ status: "awaiting" })).toBe(false);
  });
  it("labels Card (link) apart from terminal card", () => {
    expect(paymentMethodLabel("card_link")).toBe("Card (link)");
    expect(paymentMethodLabel("card")).toBe("Card");
  });
});

describe("an awaiting card-link leg is not money taken", () => {
  const shift = {
    id: "s",
    openingFloat: 0,
    closingCount: null,
    expectedCash: null,
    variance: null,
    openedAt: "2026-09-01T09:00:00Z",
    closedAt: null,
    cashierName: "Sam",
    locationName: "Main",
    status: "open",
  };
  const order = (id: string, payments: Array<{ method: string; amount: number; status?: string }>) => ({
    id,
    total: payments.reduce((s, p) => s + p.amount, 0),
    paymentMethod: payments.length > 1 ? "split" : payments[0].method,
    createdAt: "2026-09-01T10:00:00Z",
    items: [],
    payments,
  });

  it("Z report: only confirmed legs are takings; the rest is shown as awaiting", () => {
    const report = buildZReport(shift, [
      order("a", [{ method: "card_link", amount: 20, status: "awaiting" }]),
      order("b", [
        { method: "cash", amount: 5, status: "paid" },
        { method: "card_link", amount: 10, status: "paid" },
      ]),
      order("c", [{ method: "card", amount: 7, status: "paid" }]),
    ], []);
    const byMethod = Object.fromEntries(report.salesByPaymentMethod.map((r) => [r.method, r.total]));
    expect(byMethod).toEqual({ card_link: 10, card: 7, cash: 5 });
    expect(report.awaitingCardPayment).toBe(20);
    expect(report.cashSummary.cashSales).toBe(5);
    // Sold is sold: gross still counts the sale, the way credit given out does.
    expect(report.grossSales).toBe(42);
  });

  it("shift balance sheet: card link apart from the terminal, awaiting out of paid sales", () => {
    const sheet = buildCashierShiftBalanceSheet(
      [
        { ...order("a", [{ method: "card_link", amount: 20, status: "awaiting" }]), status: "pending" },
        { ...order("b", [{ method: "card_link", amount: 10, status: "paid" }]), status: "completed" },
        { ...order("c", [{ method: "card", amount: 7, status: "paid" }]), status: "completed" },
      ],
      0,
      0,
      [],
      0,
      10,
    );
    expect(sheet.cardSales).toBe(7);
    expect(sheet.cardLinkSales).toBe(10);
    expect(sheet.awaitingCardPayment).toBe(20);
    expect(sheet.paidSalesReceived).toBe(17);
  });
});

describe("access", () => {
  const rule = (method: string, path: string) => ACCESS_POLICY.find((r) => r.method === method && r.path === path);
  it("a cashier can make, cancel, send and re-tender a link", () => {
    for (const [m, p] of [
      ["GET", "/api/card-links/till"],
      ["POST", "/api/card-links/:orderId"],
      ["GET", "/api/card-links/:orderId"],
      ["POST", "/api/card-links/:orderId/cancel"],
      ["POST", "/api/card-links/:orderId/retender"],
      ["POST", "/api/card-links/:orderId/whatsapp"],
    ]) {
      const r = rule(m, p);
      expect(r, `${m} ${p}`).toBeDefined();
      expect(isAtLeast("CASHIER", r!.minRole)).toBe(true);
    }
  });
  it("only managers and above see the Stripe settings", () => {
    const r = rule("GET", "/api/settings/stripe");
    expect(r?.minRole).toBe("MANAGER");
    expect(isAtLeast("CASHIER", r!.minRole)).toBe(false);
  });
  it("card-link Signals go to managers", () => {
    expect(SIGNAL_ROUTES.card_link).toEqual({ minRole: "MANAGER" });
  });
});
