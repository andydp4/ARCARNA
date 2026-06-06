import { describe, it, expect } from "vitest";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("inventoryWorkerSkip", () => {
  it("fails when org/location context is missing", async () => {
    const { InventoryWorker } = await import("../workers/inventoryWorker");
    const worker = new InventoryWorker();
    (worker as any).resolveOrderStockContext = async () => null;

    const result = await worker.handle({
      eventId: "evt_1",
      eventType: "OrderCreated",
      occurredAt: new Date().toISOString(),
      correlationId: "order_1",
      version: 1,
      payload: { order: { orderId: "order_1", items: [] } },
    } as any);

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/missing org\/location context/);
  });
});

