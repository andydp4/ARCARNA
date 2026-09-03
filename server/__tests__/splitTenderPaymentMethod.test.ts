/**
 * Regression test for the split-tender 400.
 *
 * server/routes/orders.ts sets `body.paymentMethod = "split"` whenever an
 * order carries 2+ distinct payment legs (see the doc comment above
 * `orderPayments` in shared/schema.ts — this was always the intended label).
 * But `PlaceOrderInput` in packages/domain/src/schemas.ts, which
 * `DomainEngine.placeOrder` validates every order against, never had 'split'
 * in its `paymentMethod` enum. Every genuine multi-method split-tender order
 * (e.g. part cash, part card) has therefore always been rejected with a 400
 * `invalid_enum_value` — the single-leg case (one payment method) never hits
 * this because the route only relabels to "split" when there are 2+ legs.
 */
import { describe, expect, it } from "vitest";
import { DomainEngine } from "../../packages/domain/src/engine";

function makeEngine() {
  const saved: any[] = [];
  const orders = {
    findById: async () => null,
    save: async (o: any) => {
      saved.push(o);
    },
  };
  const products = {
    checkStock: async () => 1000,
    findById: async () => ({ id: "p1", name: "Widget" }),
  };
  const customers = {
    addTickDebt: async () => undefined,
    addOrderHistory: async () => undefined,
    updateMetrics: async () => undefined,
  };
  const invoices = { createAndStore: async () => ({ invoiceId: null }) };
  const analytics = { recordOrder: async () => undefined, updateCustomerMetrics: async () => undefined };
  const noop = async () => undefined;
  const engine = new DomainEngine(
    { publish: noop } as any,
    orders as any,
    products as any,
    customers as any,
    invoices as any,
    analytics as any,
    { log: noop } as any,
    (async (fn: any) => fn()) as any,
  );
  return { engine, saved };
}

const LINES = [{ productId: "11111111-1111-1111-1111-111111111111", quantity: 60, unitPrice: 19.33 }];

describe("POS payment labels reach the domain engine", () => {
  it("accepts paymentMethod: 'split' — the label the route assigns for 2+ payment legs", async () => {
    const { engine, saved } = makeEngine();
    const result = await engine.placeOrder({
      lines: LINES,
      paymentMethod: "split",
      orgId: "11111111-1111-1111-1111-111111111111",
      channel: "pos",
    });
    expect(result.orderId).toBeTruthy();
    expect(saved).toHaveLength(1);
    expect(saved[0].paymentMethod).toBe("split");
  });

  it("accepts paymentMethod: 'personal_use' — the label the route records for stock taken by staff", async () => {
    const { engine, saved } = makeEngine();
    const result = await engine.placeOrder({
      lines: LINES,
      paymentMethod: "personal_use",
      orgId: "11111111-1111-1111-1111-111111111111",
      channel: "pos",
    });

    expect(result.orderId).toBeTruthy();
    expect(saved).toHaveLength(1);
    expect(saved[0].paymentMethod).toBe("personal_use");
  });

  it("rejects a tick order without a customer at the domain boundary", async () => {
    const { engine } = makeEngine();
    await expect(
      engine.placeOrder({
        lines: LINES,
        paymentMethod: "tick",
        orgId: "11111111-1111-1111-1111-111111111111",
        channel: "pos",
      }),
    ).rejects.toThrow(/customer/i);
  });

  it("still rejects a genuinely invalid payment method", async () => {
    const { engine } = makeEngine();
    await expect(
      engine.placeOrder({
        lines: LINES,
        paymentMethod: "bitcoin",
        orgId: "11111111-1111-1111-1111-111111111111",
        channel: "pos",
      }),
    ).rejects.toThrow();
  });
});
