/**
 * Which orders a manager may edit, and how past edits are flagged for review
 * (v1.2 Phase 1B). Pure; no database.
 */
import { describe, expect, it } from "vitest";
import { orderEditRefusal, snapshotOrderMoney, type EditableOrderRow } from "../services/orderEdit";
import { reviewFlags } from "../services/editedOrderReview";

const row = (over: Partial<EditableOrderRow> = {}): EditableOrderRow => ({
  id: "o1",
  org_id: "org",
  status: "pending",
  total: "50.00",
  payment_method: "cash",
  subtotal: "50.00",
  tier_discount: "0.00",
  tier_discount_percent: null,
  promotion_id: null,
  promo_code: null,
  promo_discount: "0.00",
  points_redeemed: 0,
  points_discount: "0.00",
  vat_rate: "0.00",
  vat_amount: "0.00",
  ...over,
});
const lines = [{ product_id: "p", quantity: 2, unit_price: "25.00", total_price: "50.00" }];
const leg = (method: string, amount: string) => ({ id: `${method}-leg`, method, amount });

describe("orderEditRefusal", () => {
  it("allows a single-tender open order", () => {
    expect(orderEditRefusal(row(), lines, [leg("tick", "50.00")], null)).toBeNull();
  });

  it("refuses orders paid in several parts until a re-tender flow exists", () => {
    expect(orderEditRefusal(row({ payment_method: "split" }), lines, [leg("cash", "20"), leg("tick", "30")], null)?.code).toBe(
      "ORDER_EDIT_MULTI_PART",
    );
    expect(orderEditRefusal(row({ payment_method: "gift_card+cash" }), lines, [leg("gift_card+cash", "50")], null)?.code).toBe(
      "ORDER_EDIT_MULTI_PART",
    );
    expect(orderEditRefusal(row({ payment_method: "gift_card" }), lines, [leg("gift_card", "50")], null)?.code).toBe(
      "ORDER_EDIT_MULTI_PART",
    );
  });

  it("refuses completed orders, personal use, and orders on the Credit List", () => {
    expect(orderEditRefusal(row({ status: "completed" }), lines, [], null)?.code).toBe("ORDER_SETTLED_IMMUTABLE");
    expect(orderEditRefusal(row({ payment_method: "personal_use" }), lines, [], null)?.code).toBe("ORDER_EDIT_PERSONAL_USE");
    expect(orderEditRefusal(row({ payment_method: "tick" }), lines, [leg("tick", "50")], "outstanding")?.code).toBe(
      "ORDER_EDIT_ON_CREDIT_LIST",
    );
    // A voided credit (the order was reopened) is not on the list any more.
    expect(orderEditRefusal(row({ payment_method: "tick" }), lines, [leg("tick", "50")], "voided")).toBeNull();
  });

  it("refuses an order from before discounts were recorded that had money taken off", () => {
    expect(orderEditRefusal(row({ subtotal: null, total: "45.00" }), lines, [], null)?.code).toBe("ORDER_EDIT_LEGACY_DISCOUNT");
    // Same era, nothing taken off (or VAT added): nothing to lose.
    expect(orderEditRefusal(row({ subtotal: null, total: "60.00" }), lines, [], null)).toBeNull();
  });
});

describe("snapshotOrderMoney", () => {
  it("records lines, money and payments as numbers", () => {
    expect(snapshotOrderMoney(row({ tier_discount: "5.00", total: "45.00" }), lines, [leg("tick", "45.00")])).toMatchObject({
      lines: [{ productId: "p", quantity: 2, unitPrice: 25, lineTotal: 50 }],
      tierDiscount: 5,
      total: 45,
      payments: [{ method: "tick", amount: 45 }],
    });
  });
});

describe("reviewFlags", () => {
  const base = {
    total: "60.00",
    linesTotal: "50.00",
    orgVatRate: "0.00",
    paymentsTotal: "60.00",
    paymentLegs: 1,
    creditGiven: null,
    creditStatus: null,
    paymentMethod: "cash",
  };
  it("flags a total that gained 20% VAT at a shop charging less", () => {
    expect(reviewFlags(base)).toEqual(["gained_20pct_vat"]);
    expect(reviewFlags({ ...base, orgVatRate: "20.00" })).toEqual([]);
  });
  it("flags a payment record and a credit amount that do not match the total", () => {
    expect(reviewFlags({ ...base, total: "50.00", paymentsTotal: "45.00" })).toEqual(["payments_differ"]);
    expect(
      reviewFlags({ ...base, total: "50.00", paymentsTotal: "50.00", paymentMethod: "tick", creditGiven: "45.00", creditStatus: "outstanding" }),
    ).toEqual(["credit_differs"]);
  });
  it("flags money taken off before discounts were recorded", () => {
    expect(reviewFlags({ ...base, total: "45.00", paymentsTotal: "45.00" })).toEqual(["discounts_unknown"]);
  });
});
