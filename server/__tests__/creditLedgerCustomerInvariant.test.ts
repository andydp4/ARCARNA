/**
 * The credit ledger must never contain customerless debt.
 *
 * Routes try to reject this before a sale is recorded, but the ledger service
 * is the invariant boundary: if a future caller forgets the route guard, the
 * service still has to fail before it writes an invisible `order_credit` row.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const insertMock = vi.hoisted(() => vi.fn());

vi.mock("../db", () => ({
  db: { insert: insertMock },
}));

const { CreditError, openCreditForOrder } = await import("../services/creditLedger");

beforeEach(() => {
  insertMock.mockClear();
});

describe("openCreditForOrder customer invariant", () => {
  it("rejects customerless credit before inserting a ledger row", async () => {
    try {
      await openCreditForOrder("org-1", {
        id: "order-1",
        customerId: null,
        amount: 50,
      });
      throw new Error("Expected customerless credit to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(CreditError);
      expect(error).toMatchObject({
        status: 400,
        code: "CREDIT_CUSTOMER_REQUIRED",
      });
    }
    expect(insertMock).not.toHaveBeenCalled();
  });
});
