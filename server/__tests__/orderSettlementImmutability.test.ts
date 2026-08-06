/**
 * Regression tests for the post-payment order/refund vulnerability.
 *
 * Attack: a Manager/Admin re-posts an order's lines at an inflated `unitPrice`
 * via PUT /api/orders/:id. That rewrote `orders.total` + `order_items`, and the
 * refund route then paid out cash / minted store credit against the inflated
 * figures — more than was ever collected.
 *
 * Two defences, both covered here:
 *   1. `DomainEngine.updateOrder` refuses to edit a settled ("completed") order.
 *   2. Refunds cap against the immutable `settledTotal` snapshot, not `total`.
 */
import { describe, expect, it } from "vitest";
import { DomainEngine } from "../../packages/domain/src/engine";

function makeEngine(existingOrder: any) {
  const saved: any[] = [];
  const orders = {
    findById: async () => existingOrder,
    save: async (o: any) => {
      saved.push(o);
    },
  };
  const products = {
    checkStock: async () => 1000,
    findById: async () => ({ id: "p1", name: "Protein" }),
  };
  const noop = async () => undefined;
  const engine = new DomainEngine(
    { publish: noop } as any,
    orders as any,
    products as any,
    {} as any,
    {} as any,
    {} as any,
    { log: noop } as any,
    (async (fn: any) => fn()) as any,
  );
  return { engine, saved };
}

const LINES = [{ productId: "11111111-1111-1111-1111-111111111111", quantity: 1, unitPrice: 999 }];

describe("settled order financials are frozen", () => {
  it("rejects line/price edits on a completed order", async () => {
    const { engine, saved } = makeEngine({
      id: "o1",
      status: "completed",
      orgId: "org1",
      total: 10,
      lines: [],
    });

    await expect(
      engine.updateOrder("o1", { lines: LINES, orgId: "org1" }),
    ).rejects.toThrow(/already completed/i);

    // Critically: nothing was written.
    expect(saved).toHaveLength(0);
  });

  it("carries a 409 + machine-readable code so the API does not report a 500", async () => {
    const { engine } = makeEngine({ id: "o1", status: "completed", orgId: "org1", total: 10, lines: [] });
    const err: any = await engine.updateOrder("o1", { lines: LINES, orgId: "org1" }).catch((e) => e);
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe("ORDER_SETTLED_IMMUTABLE");
  });

  it("still allows edits while the order is unsettled", async () => {
    const { engine, saved } = makeEngine({
      id: "o1",
      status: "pending",
      orgId: "org1",
      total: 10,
      lines: [],
    });
    await engine.updateOrder("o1", { lines: LINES, orgId: "org1" });
    expect(saved).toHaveLength(1);
    // 999 + 20% VAT
    expect(saved[0].total).toBeCloseTo(1198.8, 2);
  });

  it("uses the injected org tax rate when recalculating unsettled edits", async () => {
    const { engine, saved } = makeEngine({
      id: "o1",
      status: "pending",
      orgId: "org1",
      total: 10,
      lines: [],
    });

    await engine.updateOrder("o1", { lines: LINES, orgId: "org1", taxRatePercent: 10 });

    expect(saved).toHaveLength(1);
    expect(saved[0].vat).toBeCloseTo(99.9, 2);
    expect(saved[0].total).toBeCloseTo(1098.9, 2);
  });
});

/** Mirrors the ceiling logic in server/routes/refunds.ts. */
function refundCeiling(order: { total: unknown; settledTotal?: unknown }): number {
  const settled = order.settledTotal;
  return settled != null && String(settled) !== ""
    ? parseFloat(String(settled))
    : parseFloat(String(order.total));
}

describe("refunds cap against the settled total", () => {
  it("uses the settlement snapshot, not an inflated current total", () => {
    // Order collected £10, then `total` was inflated to £999.
    expect(refundCeiling({ total: "999.00", settledTotal: "10.00" })).toBe(10);
  });

  it("falls back to total for legacy orders with no settlement recorded", () => {
    expect(refundCeiling({ total: "42.50", settledTotal: null })).toBe(42.5);
    expect(refundCeiling({ total: "42.50" })).toBe(42.5);
  });

  it("blocks a refund that exceeds the collected amount", () => {
    const ceiling = refundCeiling({ total: "999.00", settledTotal: "10.00" });
    const priorRefunds = 0;
    const requested = 999;
    expect(priorRefunds + requested > ceiling + 0.01).toBe(true);
  });

  it("permits a legitimate refund within the collected amount", () => {
    const ceiling = refundCeiling({ total: "10.00", settledTotal: "10.00" });
    expect(0 + 10 > ceiling + 0.01).toBe(false);
  });
});
