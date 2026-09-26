/**
 * Order-line snapshots and silent underpricing (v1.2 Phase 2: PRC-06,
 * PRC-03, CMP-03) inside the domain engine itself, with in-memory ports.
 *
 * The check lives in the engine so the till, manager edits, the API and voice
 * drafts are covered by construction. It must never block or fail a sale.
 */
import { describe, expect, it } from "vitest";
import { DomainEngine } from "../../packages/domain/src/engine";
import type { PriceExceptionRecord } from "../../packages/domain/src/ports";
import { priceOrder } from "../../shared/pricing/priceOrder";

const ORG = "11111111-1111-1111-1111-111111111111";
const P1 = "22222222-2222-2222-2222-222222222222";
const P2 = "33333333-3333-3333-3333-333333333333";

type Catalogue = Record<string, { salePrice: number; minPrice?: number | null; costPrice?: number | null }>;

function makeEngine(opts: { catalogue: Catalogue; failRecording?: boolean; noPort?: boolean }) {
  const saved = new Map<string, any>();
  const recorded: PriceExceptionRecord[] = [];
  const orders = {
    findById: async (id: string) => saved.get(id) ?? null,
    save: async (o: any) => {
      saved.set(o.id, JSON.parse(JSON.stringify(o)));
    },
  };
  const products = {
    checkStock: async () => 1000,
    findById: async (id: string) => {
      const p = opts.catalogue[id];
      return p ? { id, name: id, ...p } : null;
    },
  };
  const customers = {
    addTickDebt: async () => undefined,
    addOrderHistory: async () => undefined,
    updateMetrics: async () => undefined,
  };
  const invoices = { createAndStore: async () => ({ invoiceId: null }) };
  const analytics = { recordOrder: async () => undefined, updateCustomerMetrics: async () => undefined };
  const noop = async () => undefined;
  const calls = { record: 0, replace: 0 };
  // `recorded` is the table itself: an edit's replace mutates it in place.
  const port = {
    record: async (rows: PriceExceptionRecord[]) => {
      calls.record += 1;
      if (opts.failRecording) throw new Error("exceptions table is on fire");
      recorded.push(...rows);
    },
    forOrder: async (orgId: string, orderId: string) =>
      recorded.filter((r) => r.orgId === orgId && r.orderId === orderId).map((r) => ({ ...r })),
    replaceForOrder: async (orgId: string, orderId: string, productIds: string[], rows: PriceExceptionRecord[]) => {
      calls.replace += 1;
      if (opts.failRecording) throw new Error("exceptions table is on fire");
      for (let i = recorded.length - 1; i >= 0; i--) {
        const r = recorded[i];
        if (r.orgId === orgId && r.orderId === orderId && productIds.includes(r.productId)) recorded.splice(i, 1);
      }
      recorded.push(...rows);
    },
  };
  const engine = new DomainEngine(
    { publish: noop } as any,
    orders as any,
    products as any,
    customers as any,
    invoices as any,
    analytics as any,
    { log: noop } as any,
    (async (fn: any) => fn()) as any,
    opts.noPort ? undefined : port,
  );
  return { engine, saved, recorded, calls };
}

const catalogue: Catalogue = {
  [P1]: { salePrice: 5, minPrice: 4, costPrice: 3 },
  [P2]: { salePrice: 2, minPrice: null, costPrice: null },
};

describe("order-line snapshots (PRC-06)", () => {
  it("each line keeps list price, the minimum and known cost", async () => {
    const { engine, saved } = makeEngine({ catalogue });
    const { orderId } = await engine.placeOrder({
      orgId: ORG,
      paymentMethod: "cash",
      lines: [
        { productId: P1, quantity: 1, unitPrice: 5 },
        { productId: P2, quantity: 2, unitPrice: 2 },
      ],
    });
    const lines = saved.get(orderId).lines;
    expect(lines[0]).toMatchObject({ listPrice: 5, floorPrice: 4, unitCost: 3 });
    expect(lines[1]).toMatchObject({ listPrice: 2, floorPrice: 2, unitCost: null });
  });

  it("a product that cannot be found gets no snapshot, and the sale goes through", async () => {
    const { engine, saved } = makeEngine({ catalogue: {} });
    const { orderId } = await engine.placeOrder({
      orgId: ORG,
      paymentMethod: "cash",
      lines: [{ productId: P1, quantity: 1, unitPrice: 0.01 }],
    });
    expect(saved.get(orderId).lines[0].listPrice).toBeUndefined();
  });
});

describe("silent recording (PRC-03, CMP-03)", () => {
  it("a sale below the minimum completes and is recorded with who and how far under", async () => {
    const { engine, recorded } = makeEngine({ catalogue });
    const result = await engine.placeOrder(
      {
        orgId: ORG,
        paymentMethod: "cash",
        channel: "pos",
        lines: [
          { productId: P1, quantity: 2, unitPrice: 3.5 },
          { productId: P2, quantity: 1, unitPrice: 2 },
        ],
      },
      undefined,
      { actorUserId: "till-user" },
    );
    expect(result.orderId).toBeTruthy();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      orgId: ORG,
      orderId: result.orderId,
      productId: P1,
      userId: "till-user",
      source: "sale",
      channel: "pos",
      unitPrice: 3.5,
      listPrice: 5,
      floorPrice: 4,
      unitCost: 3,
      belowMinimum: true,
      belowCost: false,
      underList: 3,
      underCost: 0,
    });
  });

  it("below cost is recorded with £ under cost", async () => {
    const { engine, recorded } = makeEngine({ catalogue });
    await engine.placeOrder({
      orgId: ORG,
      paymentMethod: "card",
      channel: "api",
      lines: [{ productId: P1, quantity: 1, unitPrice: 2 }],
    });
    expect(recorded[0]).toMatchObject({ belowCost: true, underCost: 1, underList: 3, channel: "api" });
  });

  it("any price under list is flagged when the minimum follows the sale price (no allowance, Q3)", async () => {
    const { engine, recorded } = makeEngine({ catalogue });
    await engine.placeOrder({
      orgId: ORG,
      paymentMethod: "cash",
      lines: [{ productId: P2, quantity: 1, unitPrice: 1.99 }],
    });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ belowMinimum: true, belowCost: false, underList: 0.01 });
  });

  it("a recording failure never fails or blocks the sale", async () => {
    const { engine, saved, calls } = makeEngine({ catalogue, failRecording: true });
    const result = await engine.placeOrder({
      orgId: ORG,
      paymentMethod: "cash",
      lines: [{ productId: P1, quantity: 1, unitPrice: 0.5 }],
    });
    // The recorder really ran (and threw); the sale was still saved.
    expect(calls.record).toBe(1);
    expect(saved.get(result.orderId)).toBeTruthy();
  });

  it("website orders are exempt only when the server's checkout says so", async () => {
    const { engine, recorded } = makeEngine({ catalogue });
    await engine.placeOrder(
      {
        orgId: ORG,
        paymentMethod: "transfer",
        channel: "web",
        lines: [{ productId: P1, quantity: 1, unitPrice: 5 }],
      },
      undefined,
      { pricedAtList: true },
    );
    expect(recorded).toHaveLength(0);
  });

  it("a till or API caller sending channel 'web' is still checked", async () => {
    const { engine, recorded } = makeEngine({ catalogue });
    const { orderId } = await engine.placeOrder(
      {
        orgId: ORG,
        paymentMethod: "cash",
        channel: "web",
        lines: [{ productId: P1, quantity: 1, unitPrice: 0.5 }],
      },
      undefined,
      { actorUserId: "till-user" },
    );
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ orderId, channel: "web", belowCost: true, underList: 4.5, underCost: 2.5 });
  });

  it("a trade tier that takes a list-priced line below cost is recorded (Q3: no trade exemption)", async () => {
    const trade: Catalogue = { [P1]: { salePrice: 10, minPrice: null, costPrice: 8 } };
    const { engine, recorded } = makeEngine({ catalogue: trade });
    const pricing = priceOrder({
      lines: [{ quantity: 1, unitPrice: 10 }],
      taxRatePercent: 0,
      customer: { loyaltyPoints: 1000 },
      tiers: [{ id: "t", name: "Trade", pointsRequired: 0, discountPercentage: 30 }],
    });
    expect(pricing.total).toBe(7);
    await engine.placeOrder(
      { orgId: ORG, paymentMethod: "cash", lines: [{ productId: P1, quantity: 1, unitPrice: 10 }] },
      pricing,
    );
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      unitPrice: 7,
      listPrice: 10,
      belowMinimum: true,
      belowCost: true,
      underList: 3,
      underCost: 1,
    });
  });

  it("a manager-approved promotion that takes a line below its floor is not recorded (v1.2.1 money)", async () => {
    const { engine, recorded } = makeEngine({ catalogue });
    const pricing = priceOrder({
      lines: [{ quantity: 1, unitPrice: 5 }],
      taxRatePercent: 0,
      promotion: {
        id: "promo1",
        name: "Staff sale",
        code: "STAFF",
        type: "percentage",
        value: 30,
        isActive: true,
        startDate: new Date(Date.now() - 86_400_000).toISOString(),
        endDate: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    // £5 less 30% is £3.50, under P1's £4 minimum — only because of the promo.
    expect(pricing.total).toBe(3.5);
    await engine.placeOrder(
      { orgId: ORG, paymentMethod: "cash", lines: [{ productId: P1, quantity: 1, unitPrice: 5 }] },
      pricing,
    );
    expect(recorded).toHaveLength(0);
  });

  it("a promotion that discounts a line already below its floor still records the rest of the breach", async () => {
    const { engine, recorded } = makeEngine({ catalogue });
    const pricing = priceOrder({
      lines: [{ quantity: 1, unitPrice: 3 }],
      taxRatePercent: 0,
      promotion: {
        id: "promo1",
        name: "Staff sale",
        code: "STAFF",
        type: "percentage",
        value: 10,
        isActive: true,
        startDate: new Date(Date.now() - 86_400_000).toISOString(),
        endDate: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    // £3 is already under P1's £4 floor before the 10% comes off.
    await engine.placeOrder(
      { orgId: ORG, paymentMethod: "cash", lines: [{ productId: P1, quantity: 1, unitPrice: 3 }] },
      pricing,
    );
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ belowMinimum: true });
  });

  it("personal use is not a sale and is not checked", async () => {
    const { engine, recorded } = makeEngine({ catalogue });
    await engine.placeOrder({
      orgId: ORG,
      paymentMethod: "personal_use",
      lines: [{ productId: P1, quantity: 1, unitPrice: 0 }],
    });
    expect(recorded).toHaveLength(0);
  });

  it("without a recorder wired, sales are unaffected", async () => {
    const { engine } = makeEngine({ catalogue, noPort: true });
    await expect(
      engine.placeOrder({ orgId: ORG, paymentMethod: "cash", lines: [{ productId: P1, quantity: 1, unitPrice: 1 }] }),
    ).resolves.toHaveProperty("orderId");
  });
});

describe("manager edits", () => {
  it("keep the sale's snapshot, record a new breach as the editor, and do not repeat an old one", async () => {
    const cat: Catalogue = { ...catalogue, [P1]: { ...catalogue[P1] } };
    const { engine, saved, recorded } = makeEngine({ catalogue: cat });
    const { orderId } = await engine.placeOrder(
      {
        orgId: ORG,
        paymentMethod: "cash",
        lines: [
          { productId: P1, quantity: 1, unitPrice: 3.5 },
          { productId: P2, quantity: 1, unitPrice: 2 },
        ],
      },
      undefined,
      { actorUserId: "till-user" },
    );
    expect(recorded).toHaveLength(1);

    // The cost and price change after the sale; the edit must not pick them up.
    cat[P1].costPrice = 9;
    cat[P1].salePrice = 12;

    await engine.updateOrder(
      orderId,
      {
        lines: [
          { productId: P1, quantity: 1, unitPrice: 3.5 }, // unchanged: already recorded
          { productId: P2, quantity: 1, unitPrice: 1.5 }, // newly under list
        ],
      },
      undefined,
      { actorUserId: "manager-user", orgId: ORG },
    );
    const lines = saved.get(orderId).lines;
    expect(lines[0]).toMatchObject({ listPrice: 5, floorPrice: 4, unitCost: 3 });
    expect(recorded).toHaveLength(2);
    expect(recorded[1]).toMatchObject({ productId: P2, source: "edit", userId: "manager-user", underList: 0.5 });
  });

  async function soldAt(unitPrice: number, quantity: number) {
    const env = makeEngine({ catalogue });
    const { orderId } = await env.engine.placeOrder(
      { orgId: ORG, paymentMethod: "cash", lines: [{ productId: P1, quantity, unitPrice }] },
      undefined,
      { actorUserId: "till-user" },
    );
    const edit = (lines: Array<{ productId: string; quantity: number; unitPrice: number }>) =>
      env.engine.updateOrder(orderId, { lines }, undefined, { actorUserId: "manager-user", orgId: ORG });
    return { ...env, orderId, edit };
  }
  const totals = (rows: PriceExceptionRecord[]) => ({
    lines: rows.length,
    units: rows.reduce((a, r) => a + r.quantity, 0),
    underList: Math.round(rows.reduce((a, r) => a + r.underList, 0) * 100) / 100,
  });

  it("raising the quantity of a breach counts it once, as it now stands", async () => {
    const { recorded, edit } = await soldAt(3, 2);
    expect(totals(recorded)).toEqual({ lines: 1, units: 2, underList: 4 });
    await edit([{ productId: P1, quantity: 3, unitPrice: 3 }]);
    expect(totals(recorded)).toEqual({ lines: 1, units: 3, underList: 6 });
    expect(recorded[0]).toMatchObject({ source: "edit", userId: "manager-user" });
  });

  it("changing the price of a breach replaces it rather than adding to it", async () => {
    const { recorded, edit } = await soldAt(3, 1);
    await edit([{ productId: P1, quantity: 1, unitPrice: 3.5 }]);
    expect(totals(recorded)).toEqual({ lines: 1, units: 1, underList: 1.5 });
  });

  it("an edit that lifts the line above its floor, or removes it, clears the breach", async () => {
    const lifted = await soldAt(3, 1);
    await lifted.edit([{ productId: P1, quantity: 1, unitPrice: 5 }]);
    expect(lifted.recorded).toHaveLength(0);

    const removed = await soldAt(3, 1);
    await removed.edit([{ productId: P2, quantity: 1, unitPrice: 2 }]);
    expect(removed.recorded).toHaveLength(0);
  });

  it("an edit that leaves a breach exactly as it was keeps the original row and who it was against", async () => {
    const { recorded, edit, calls } = await soldAt(3, 2);
    await edit([{ productId: P1, quantity: 2, unitPrice: 3 }]);
    expect(calls.replace).toBe(0);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ source: "sale", userId: "till-user", underList: 4 });
  });
});
