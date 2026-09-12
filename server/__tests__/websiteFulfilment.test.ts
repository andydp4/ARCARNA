/**
 * Website orders land in the right lane with a promise (N3a, finding G19).
 *
 * Before this package every website order arrived with NO `fulfilmentMethod`
 * at all — the column's own default silently put a chosen delivery in
 * Collection — and no due time, so the board could only ever show it against
 * the org's bare SLA fallback with nothing to say a customer had been
 * promised anything. `submitPublicOrder` (server/services/website.ts) now
 * maps the customer's own "pickup"/"delivery" onto the board's
 * `FulfilmentMethod` and writes a due promise from the same SLA settings the
 * board itself would otherwise fall back to.
 */
import { describe, expect, it, vi } from "vitest";
import { createWebsiteService, type WebsiteOrderRuntime, type WebsiteRepository } from "../services/website";

const ORG_ID = "org-1";
const PRODUCT_ID = "00000000-0000-4000-8000-000000000001";

function repo(): WebsiteRepository {
  return {
    getOrg: vi.fn().mockResolvedValue({ id: ORG_ID, name: "Arcana" }),
    getThemeSettings: vi.fn().mockResolvedValue(null),
    upsertThemeSettings: vi.fn(),
    getOrderSettings: vi.fn().mockResolvedValue(null),
    upsertOrderSettings: vi.fn(),
    listBlocks: vi.fn().mockResolvedValue([]),
    upsertBlock: vi.fn(),
    updateBlock: vi.fn(),
    duplicateBlock: vi.fn(),
    deleteBlock: vi.fn(),
    createUpload: vi.fn(),
    listUploads: vi.fn().mockResolvedValue([]),
    listPublicProducts: vi.fn().mockResolvedValue([]),
    listWebsiteOrderProducts: vi.fn().mockResolvedValue([
      {
        id: PRODUCT_ID,
        productId: "SKU-1",
        name: "Cups",
        defaultSalePrice: "15.00",
        availableForWebsite: true,
        stock: 10,
      },
    ]),
  };
}

function runtime(overrides: Partial<WebsiteOrderRuntime> = {}): WebsiteOrderRuntime {
  return {
    withTransaction: vi.fn(async (fn) => fn({ tx: true })),
    getOrgTaxRatePercent: vi.fn().mockResolvedValue(undefined),
    getOpsDueMinutes: vi.fn().mockImplementation(async (_orgId, fulfilmentMethod) =>
      fulfilmentMethod === "delivery" ? 45 : 20,
    ),
    setOrderDuePromise: vi.fn().mockResolvedValue(undefined),
    engine: {
      createCustomer: vi.fn().mockResolvedValue({ id: "customer-1" }),
      placeOrder: vi.fn().mockResolvedValue({ orderId: "order-1", warnings: [] }),
    },
    publishOrderCreated: vi.fn().mockResolvedValue("event-1"),
    loadCreatedOrder: vi.fn().mockResolvedValue({
      id: "order-1",
      status: "pending",
      total: "30.00",
      paymentMethod: "transfer",
      customerId: "customer-1",
      items: [],
    }),
    ...overrides,
  };
}

const order = (fulfilment: { method: "pickup" | "delivery" }) => ({
  customer: { name: "Ada Buyer", email: "ada@example.com" },
  fulfilment,
  items: [{ productId: PRODUCT_ID, quantity: 1 }],
});

describe("website fulfilment mapping", () => {
  it("maps 'pickup' onto the board's 'collection'", async () => {
    const service = createWebsiteService(repo());
    const rt = runtime();
    await service.submitPublicOrder(ORG_ID, order({ method: "pickup" }), rt);

    expect(rt.engine.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({ fulfilmentMethod: "collection" }),
    );
  });

  it("maps 'delivery' straight through", async () => {
    const service = createWebsiteService(repo());
    const rt = runtime();
    await service.submitPublicOrder(ORG_ID, order({ method: "delivery" }), rt);

    expect(rt.engine.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({ fulfilmentMethod: "delivery" }),
    );
  });

  it("defaults to 'pickup' -> 'collection' when the customer sent no fulfilment at all", async () => {
    const service = createWebsiteService(repo());
    const rt = runtime();
    await service.submitPublicOrder(
      ORG_ID,
      { customer: { name: "Ada Buyer" }, items: [{ productId: PRODUCT_ID, quantity: 1 }] },
      rt,
    );

    expect(rt.engine.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({ fulfilmentMethod: "collection" }),
    );
  });
});

describe("website due-time fallback", () => {
  it("writes a due promise using the prep SLA for a collection order", async () => {
    const service = createWebsiteService(repo());
    const rt = runtime();
    const before = Date.now();

    await service.submitPublicOrder(ORG_ID, order({ method: "pickup" }), rt);

    expect(rt.getOpsDueMinutes).toHaveBeenCalledWith(ORG_ID, "collection");
    expect(rt.setOrderDuePromise).toHaveBeenCalledTimes(1);
    const [, orderId, etaGiven] = (rt.setOrderDuePromise as any).mock.calls[0];
    expect(orderId).toBe("order-1");
    // ~20 minutes ahead (the mocked prep SLA), never `ready_at` — this order
    // has not been prepared, only promised.
    const minutesAhead = (etaGiven.getTime() - before) / 60_000;
    expect(minutesAhead).toBeGreaterThan(19);
    expect(minutesAhead).toBeLessThan(21);
  });

  it("writes a due promise using the delivery lead for a delivery order", async () => {
    const service = createWebsiteService(repo());
    const rt = runtime();
    const before = Date.now();

    await service.submitPublicOrder(ORG_ID, order({ method: "delivery" }), rt);

    expect(rt.getOpsDueMinutes).toHaveBeenCalledWith(ORG_ID, "delivery");
    const [, , etaGiven] = (rt.setOrderDuePromise as any).mock.calls[0];
    const minutesAhead = (etaGiven.getTime() - before) / 60_000;
    expect(minutesAhead).toBeGreaterThan(44);
    expect(minutesAhead).toBeLessThan(46);
  });

  it("writes the due promise inside the same transaction the order was created in", async () => {
    const service = createWebsiteService(repo());
    const rt = runtime();
    const seenTx: unknown[] = [];
    (rt.setOrderDuePromise as any).mockImplementation(async (tx: unknown) => {
      seenTx.push(tx);
    });

    await service.submitPublicOrder(ORG_ID, order({ method: "pickup" }), rt);

    expect(seenTx).toEqual([{ tx: true }]);
  });
});
