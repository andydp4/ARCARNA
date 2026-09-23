import { describe, expect, it } from "vitest";
import {
  belowFloorMessage,
  checkTillPrice,
  confirmationProblem,
  didYouMeanPrice,
  evaluateOrderGuard,
  priceGuardSignalLine,
  readConfirmation,
  type GuardLine,
} from "./priceGuard";

/** Price guard at the till (v1.2 Phase 4, PRC-02): one rule for the till and the server. */

describe("checkTillPrice", () => {
  const widget = { floor: 4, listPrice: 5 };

  it("is quiet at or above the floor, compared in pence", () => {
    expect(checkTillPrice({ unitPrice: 4, ...widget })).toBeNull();
    expect(checkTillPrice({ unitPrice: 4.001, ...widget })).toBeNull();
    // 3.999 rounds to 400p: not below a £4.00 floor.
    expect(checkTillPrice({ unitPrice: 3.999, ...widget })).toBeNull();
    expect(checkTillPrice({ unitPrice: 5, ...widget })).toBeNull();
  });

  it("one warning below the floor, carrying the lowest price and nothing else", () => {
    expect(checkTillPrice({ unitPrice: 3.99, ...widget })).toEqual({ kind: "below", floor: 4 });
    expect(belowFloorMessage(4)).toBe(
      "Below the lowest price for this item (£4.00). You can still sell at this price; a manager will see it.",
    );
  });

  it("£0 is always below when the item has a price, even with a £0 minimum", () => {
    expect(checkTillPrice({ unitPrice: 0, floor: 0, listPrice: 5 })?.kind).toBe("below");
    expect(checkTillPrice({ unitPrice: 0, floor: 4, listPrice: 5 })?.kind).toBe("below");
    // A free item left at its own £0 list price is not a discount.
    expect(checkTillPrice({ unitPrice: 0, floor: 0, listPrice: 0 })).toBeNull();
  });

  it("a weighed item is judged per kg, not on the line total", () => {
    // £12/kg with a £10/kg floor, 0.3 kg on the scale: £3.60 line, fine.
    expect(checkTillPrice({ unitPrice: 12, floor: 10, listPrice: 14 })).toBeNull();
    expect(checkTillPrice({ unitPrice: 9.5, floor: 10, listPrice: 14 })?.kind).toBe("below");
  });

  it("more than 3× list suggests the likely price, with no flag", () => {
    expect(checkTillPrice({ unitPrice: 45, floor: 4, listPrice: 4.5 })).toEqual({ kind: "did_you_mean", suggestion: 4.5 });
    expect(checkTillPrice({ unitPrice: 450, floor: 4, listPrice: 4.5 })).toEqual({ kind: "did_you_mean", suggestion: 4.5 });
    expect(checkTillPrice({ unitPrice: 13.5, floor: 4, listPrice: 4.5 })).toBeNull();
  });

  it("did you mean falls back to the list price when no slipped decimal fits", () => {
    expect(didYouMeanPrice(20, 5)).toBe(5);
    expect(didYouMeanPrice(49, 5)).toBe(4.9);
  });
});

describe("confirmation", () => {
  it("Other needs a note and Manager agreed needs a manager", () => {
    expect(confirmationProblem({ reason: "trade" })).toBeNull();
    expect(confirmationProblem({ reason: "other", note: " " })).toMatch(/reason/);
    expect(confirmationProblem({ reason: "other", note: "Loyal regular" })).toBeNull();
    expect(confirmationProblem({ reason: "manager_agreed" })).toMatch(/manager/);
    expect(confirmationProblem({ reason: "manager_agreed", managerUserId: "alex" })).toBeNull();
  });

  it("a malformed confirmation reads as none: the sale is never refused for it", () => {
    expect(readConfirmation({ reason: "bribe", lines: [] })).toBeNull();
    expect(readConfirmation("yes")).toBeNull();
    expect(readConfirmation(undefined)).toBeNull();
    expect(readConfirmation({ reason: "trade", lines: [{ productId: "p", unitPrice: 3 }] })?.reason).toBe("trade");
  });
});

describe("evaluateOrderGuard", () => {
  const line = (over: Partial<GuardLine> = {}): GuardLine => ({
    productId: "p1",
    quantity: 2,
    unitPrice: 3,
    listPrice: 5,
    floorPrice: 4,
    unitCost: 2,
    ...over,
  });
  const trade = (lines: Array<{ productId: string; unitPrice: number }>) =>
    ({ reason: "trade" as const, lines });

  it("a keyed price below the minimum needs confirming; confirmed when the till sent it", () => {
    const v = evaluateOrderGuard([line()], null, trade([{ productId: "p1", unitPrice: 3 }]));
    expect(v.flagged).toHaveLength(1);
    expect(v.flagged[0]).toMatchObject({ needsConfirmation: true, confirmed: true, underMinimum: 2 });
    expect(v.confirmed).toBe(true);
    expect(v.underMinimum).toBe(2);
    expect(v.linesBelowCost).toBe(0);
  });

  it("no confirmation, or one for a different price, is unconfirmed", () => {
    expect(evaluateOrderGuard([line()], null, null).confirmed).toBe(false);
    expect(evaluateOrderGuard([line()], null, trade([{ productId: "p1", unitPrice: 3.5 }])).confirmed).toBe(false);
    // An incomplete reason does not count either.
    expect(
      evaluateOrderGuard([line()], null, { reason: "other", lines: [{ productId: "p1", unitPrice: 3 }] }).confirmed,
    ).toBe(false);
  });

  it("discounts that take a list-priced line below its minimum are flagged without asking the cashier", () => {
    const v = evaluateOrderGuard(
      [line({ unitPrice: 5, quantity: 1 })],
      { subtotal: 5, netAfterDiscounts: 3.5, pointsDiscount: 0, vatRate: 0 },
      null,
    );
    expect(v.flagged[0]).toMatchObject({ needsConfirmation: false, underMinimum: 0.5 });
    expect(v.confirmed).toBeNull();
  });

  it("the order-level below-cost check runs after all discounts, lines offsetting each other", () => {
    // Two lines: £10 (cost £4) and £5 (cost £8). Lines: one below cost. Order: 15 vs 12, fine.
    const lines = [
      line({ productId: "a", quantity: 1, unitPrice: 10, listPrice: 10, floorPrice: 10, unitCost: 4 }),
      line({ productId: "b", quantity: 1, unitPrice: 5, listPrice: 5, floorPrice: 5, unitCost: 8 }),
    ];
    const plain = evaluateOrderGuard(lines, null, null);
    expect(plain.linesBelowCost).toBe(1);
    expect(plain.orderBelowCost).toBe(false);
    expect(plain.underCost).toBe(3);
    // A £5 promotion: £10 net against £12 cost — below cost as an order.
    const promo = evaluateOrderGuard(lines, { subtotal: 15, netAfterDiscounts: 10, pointsDiscount: 0, vatRate: 0 }, null);
    expect(promo.orderBelowCost).toBe(true);
    expect(promo.underCost).toBeGreaterThanOrEqual(2);
    expect(promo.any).toBe(true);
  });

  it("unknown cost is never costed at £0", () => {
    const v = evaluateOrderGuard([line({ unitPrice: 4, unitCost: null })], null, null);
    expect(v.any).toBe(false);
  });

  it("a line with no snapshot is not judged against a made-up floor", () => {
    const v = evaluateOrderGuard([line({ floorPrice: null, listPrice: null, unitCost: null, unitPrice: 0 })], null, null);
    expect(v.any).toBe(false);
  });
});

describe("priceGuardSignalLine", () => {
  const verdict = evaluateOrderGuard(
    [
      { productId: "a", quantity: 2, unitPrice: 3, listPrice: 5, floorPrice: 4, unitCost: 1 },
      { productId: "b", quantity: 1, unitPrice: 5.6, listPrice: 10, floorPrice: 10, unitCost: 1 },
    ],
    null,
    { reason: "trade", lines: [{ productId: "a", unitPrice: 3 }, { productId: "b", unitPrice: 5.6 }] },
  );

  it("reads as the brief's one line", () => {
    expect(priceGuardSignalLine({ verdict, orderRef: "#123", who: "Sam", reason: "trade" })).toBe(
      "£6.40 under minimum on order #123 by Sam: 2 lines, reason: Trade customer.",
    );
  });

  it("names the manager for Manager agreed, and says so when unconfirmed", () => {
    expect(
      priceGuardSignalLine({ verdict, orderRef: "#1", who: "Sam", reason: "manager_agreed", managerName: "Alex" }),
    ).toContain("reason: Manager agreed: Alex");
    const bare = evaluateOrderGuard(
      [{ productId: "a", quantity: 1, unitPrice: 3, listPrice: 5, floorPrice: 4, unitCost: null }],
      null,
      null,
    );
    expect(priceGuardSignalLine({ verdict: bare, orderRef: "#1", who: "Sam", reason: null })).toContain(
      "no reason given (unconfirmed)",
    );
  });
});
