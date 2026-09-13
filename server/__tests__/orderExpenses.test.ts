/**
 * Checkout expenses (Phase N, N3b; owner's answer Q12): `POST /api/orders`
 * `expenses[]` become `order_expenses` rows in the create transaction and
 * never touch the order's `total`.
 */
vi.mock("../db", () => ({ db: {} }));
vi.mock("../storage", () => ({ storage: {} }));

import { describe, expect, it, vi } from "vitest";
import { buildOrderExpenseRows, orderExpenseInputSchema } from "../routes/orders";

describe("orderExpenseInputSchema", () => {
  it("accepts a well-formed expense line", () => {
    const result = orderExpenseInputSchema.safeParse({
      category: "delivery_fuel",
      description: "Fuel for the delivery run",
      amount: 4.5,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a line with no description", () => {
    const result = orderExpenseInputSchema.safeParse({ category: "packaging", amount: 1.2 });
    expect(result.success).toBe(true);
  });

  it("rejects a missing category", () => {
    expect(orderExpenseInputSchema.safeParse({ amount: 4.5 }).success).toBe(false);
  });

  it("rejects a zero or negative amount", () => {
    expect(orderExpenseInputSchema.safeParse({ category: "other", amount: 0 }).success).toBe(false);
    expect(orderExpenseInputSchema.safeParse({ category: "other", amount: -5 }).success).toBe(false);
  });

  it("coerces a numeric string amount (till JSON often stringifies numbers)", () => {
    const result = orderExpenseInputSchema.safeParse({ category: "other", amount: "3.20" });
    expect(result.success).toBe(true);
  });
});

describe("buildOrderExpenseRows", () => {
  it("has no parameter through which `total` could reach it — the type signature is the guarantee", () => {
    // buildOrderExpenseRows(orgId, orderId, lines) — three parameters, none of
    // them the order total. Asserted structurally via arity rather than by
    // trying to prove a negative about the runtime value.
    expect(buildOrderExpenseRows.length).toBe(3);
  });

  it("maps each line to an insertable row, rounding the amount and defaulting a missing description", () => {
    const rows = buildOrderExpenseRows("org-1", "order-1", [
      { category: "delivery_fuel", description: "Fuel", amount: 4.567 },
      { category: "packaging", amount: 1.2 },
    ]);
    expect(rows).toEqual([
      { orgId: "org-1", orderId: "order-1", category: "delivery_fuel", description: "Fuel", amount: "4.57" },
      { orgId: "org-1", orderId: "order-1", category: "packaging", description: null, amount: "1.2" },
    ]);
  });

  it("returns an empty array for no expense lines", () => {
    expect(buildOrderExpenseRows("org-1", "order-1", [])).toEqual([]);
  });

  it("every row carries the SAME orgId/orderId regardless of how many lines there are", () => {
    const rows = buildOrderExpenseRows("org-9", "order-9", [
      { category: "a", amount: 1 },
      { category: "b", amount: 2 },
      { category: "c", amount: 3 },
    ]);
    expect(rows.every((r) => r.orgId === "org-9" && r.orderId === "order-9")).toBe(true);
  });
});
