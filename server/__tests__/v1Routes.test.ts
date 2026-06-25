import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerV1Routes } from "../routes/v1";

const mocks = vi.hoisted(() => ({
  adjustProductLocationStock: vi.fn(),
  getProduct: vi.fn(),
  getProductsForOrgPublic: vi.fn(),
  placeOrder: vi.fn(),
  publishEventTx: vi.fn(),
  serverDb: {
    select: vi.fn(),
  },
  verifyApiKeyAndGetOrg: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: {
    getProduct: mocks.getProduct,
    getProductsForOrgPublic: mocks.getProductsForOrgPublic,
    verifyApiKeyAndGetOrg: mocks.verifyApiKeyAndGetOrg,
  },
}));

vi.mock("../../apps/server/src/engine.wiring", () => ({
  engine: {
    placeOrder: mocks.placeOrder,
  },
}));

vi.mock("../../apps/server/src/db", () => ({
  withTransaction: mocks.withTransaction,
}));

vi.mock("../eventBus", () => ({
  publishEventTx: mocks.publishEventTx,
}));

vi.mock("../db", () => ({
  db: mocks.serverDb,
}));

vi.mock("../services/productLocationStock", () => ({
  adjustProductLocationStock: mocks.adjustProductLocationStock,
}));

function makeApp() {
  const app = express();
  app.use(express.json());
  registerV1Routes(app);
  return app;
}

function selectWhereRows(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve(rows)),
    })),
  };
}

function selectWhereLimitRows(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve(rows)),
      })),
    })),
  };
}

function updateReturningRows(rows: unknown[]) {
  return {
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve(rows)),
      })),
    })),
  };
}

describe("v1 public API routes", () => {
  const orgId = "org-1";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyApiKeyAndGetOrg.mockResolvedValue({ orgId, scopes: ["*"] });
    mocks.publishEventTx.mockResolvedValue("event-1");
  });

  it("creates orders and writes the OrderCreated outbox event in the same transaction", async () => {
    const tx = {
      select: vi
        .fn()
        .mockReturnValueOnce(
          selectWhereRows([
            {
              id: "order-1",
              org_id: orgId,
              status: "pending",
              customer_id: "customer-1",
              total: "12.00",
              payment_method: "cash",
              created_at: new Date("2026-01-01T00:00:00Z"),
            },
          ]),
        )
        .mockReturnValueOnce(
          selectWhereRows([
            {
              id: "line-1",
              product_id: "product-1",
              quantity: 2,
              unit_price: "5.00",
              total_price: "10.00",
            },
          ]),
        ),
    };
    mocks.withTransaction.mockImplementation(async (fn) => fn(tx));
    mocks.placeOrder.mockResolvedValue({ orderId: "order-1", warnings: [] });

    const response = await request(makeApp())
      .post(`/v1/orgs/${orgId}/orders`)
      .set("Authorization", "Bearer mk_test")
      .send({
        customerId: "customer-1",
        lines: [{ productId: "product-1", quantity: 2, unitPrice: 5 }],
        paymentMethod: "cash",
      });

    expect(response.status).toBe(201);
    expect(mocks.withTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({ orgId, paymentMethod: "cash" }),
    );
    expect(mocks.publishEventTx).toHaveBeenCalledWith(
      tx,
      "OrderCreated",
      "order-1",
      expect.objectContaining({
        order: expect.objectContaining({
          orderId: "order-1",
          items: [
            {
              lineId: "line-1",
              productId: "product-1",
              qty: 2,
              unitPrice: 5,
              lineTotal: 10,
            },
          ],
        }),
      }),
      { source: "v1-api" },
    );
    expect(response.body.eventId).toBe("event-1");
  });

  it("rejects v1 gift-card orders instead of saving unpaid redemptions", async () => {
    const response = await request(makeApp())
      .post(`/v1/orgs/${orgId}/orders`)
      .set("Authorization", "Bearer mk_test")
      .send({
        lines: [{ productId: "product-1", quantity: 1, unitPrice: 5 }],
        paymentMethod: "gift_card",
      });

    expect(response.status).toBe(400);
    expect(mocks.placeOrder).not.toHaveBeenCalled();
    expect(mocks.publishEventTx).not.toHaveBeenCalled();
  });

  it("validates status patches and publishes OrderStatusChanged", async () => {
    const tx = {
      select: vi.fn().mockReturnValueOnce(selectWhereRows([{ status: "pending" }])),
      update: vi.fn().mockReturnValueOnce(
        updateReturningRows([
          {
            id: "order-1",
            org_id: orgId,
            status: "completed",
          },
        ]),
      ),
    };
    mocks.withTransaction.mockImplementation(async (fn) => fn(tx));

    const response = await request(makeApp())
      .patch(`/v1/orgs/${orgId}/orders/order-1`)
      .set("Authorization", "Bearer mk_test")
      .send({ status: "completed" });

    expect(response.status).toBe(200);
    expect(mocks.publishEventTx).toHaveBeenCalledWith(
      tx,
      "OrderStatusChanged",
      "order-1",
      expect.objectContaining({
        from: "pending",
        orderId: "order-1",
        to: "completed",
      }),
      { source: "v1-api" },
    );
    expect(response.body.eventId).toBe("event-1");
  });

  it("rejects invalid status patches before updating the order", async () => {
    const response = await request(makeApp())
      .patch(`/v1/orgs/${orgId}/orders/order-1`)
      .set("Authorization", "Bearer mk_test")
      .send({ status: "shipped" });

    expect(response.status).toBe(400);
    expect(mocks.withTransaction).not.toHaveBeenCalled();
    expect(mocks.publishEventTx).not.toHaveBeenCalled();
  });

  it("blocks inventory adjustments for products outside the API key org", async () => {
    mocks.serverDb.select.mockReturnValueOnce(selectWhereLimitRows([]));

    const response = await request(makeApp())
      .post(`/v1/orgs/${orgId}/inventory/adjust`)
      .set("Authorization", "Bearer mk_test")
      .send({
        productId: "other-org-product",
        locationId: "location-1",
        delta: 1,
      });

    expect(response.status).toBe(404);
    expect(mocks.adjustProductLocationStock).not.toHaveBeenCalled();
  });
});
