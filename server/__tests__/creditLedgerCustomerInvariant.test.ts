/**
 * Credit without a customer is uncollectable: the credit list is customer-based,
 * so a null customer row can be real debt that no screen can chase.
 */
import { describe, expect, it, vi } from "vitest";

const insertMock = vi.hoisted(() => vi.fn());

vi.mock("../db", () => ({
  db: { insert: insertMock },
  pool: {},
}));

const { openCreditForOrder } = await import("../services/creditLedger");

describe("credit customer invariant", () => {
  it("refuses to open customerless credit before writing a row", async () => {
    await expect(
      openCreditForOrder("00000000-0000-4000-8000-000000000001", {
        id: "00000000-0000-4000-8000-000000000002",
        customerId: null,
        amount: 25,
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "CREDIT_CUSTOMER_REQUIRED",
    });

    expect(insertMock).not.toHaveBeenCalled();
  });
});
