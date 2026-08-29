import { describe, expect, it, vi } from "vitest";

const insertMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("openCreditForOrder should reject before touching the database");
  }),
);

vi.mock("../db", () => ({ db: { insert: insertMock }, pool: {} }));
vi.mock("../services/cashierShiftEngine", () => ({ resolveCommissionRate: vi.fn() }));
vi.mock("@shared/schema", () => ({
  cashierCommissionEntries: {},
  cashierProfiles: {},
  creditPayments: {},
  orderCredit: {},
  orderExpenses: {},
  orderItems: {},
  orderPayments: {},
  orders: {},
  organizations: {},
  products: {},
  refunds: {},
  users: {},
}));

const { openCreditForOrder } = await import("../services/creditLedger");

describe("credit ledger customer invariant", () => {
  it("rejects positive credit that has no customer before inserting an invisible debt", async () => {
    await expect(
      openCreditForOrder("00000000-0000-4000-8000-000000000001", {
        id: "00000000-0000-4000-8000-0000000000aa",
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
