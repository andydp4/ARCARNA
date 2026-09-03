import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ db: {}, pool: {} }));

const { openCreditForOrder } = await import("../services/creditLedger");

describe("credit ledger invariants", () => {
  it("refuses to open customerless credit debt", async () => {
    await expect(
      openCreditForOrder("00000000-0000-4000-8000-000000000001", {
        id: "00000000-0000-4000-8000-0000000000aa",
        customerId: null,
        amount: 12.5,
      }),
    ).rejects.toMatchObject({ code: "CREDIT_CUSTOMER_REQUIRED", status: 400 });
  });
});
