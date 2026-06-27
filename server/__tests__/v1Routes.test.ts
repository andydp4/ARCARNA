import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

const orgId = "123e4567-e89b-12d3-a456-426614174000";

async function createV1App(scopes = ["orders:write"]) {
  process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/midnight_test";
  vi.resetModules();
  vi.doMock("../storage", () => ({
    storage: {
      verifyApiKeyAndGetOrg: vi.fn().mockResolvedValue({ orgId, scopes }),
    },
  }));
  const { registerV1Routes } = await import("../routes/v1");
  const app = express();
  app.use(express.json());
  registerV1Routes(app);
  return app;
}

afterEach(() => {
  vi.doUnmock("../storage");
  vi.resetModules();
});

describe("v1 order routes", () => {
  it("rejects invalid order statuses before updating", async () => {
    const app = await createV1App();

    const response = await request(app)
      .patch(`/v1/orgs/${orgId}/orders/123e4567-e89b-12d3-a456-426614174111`)
      .set("Authorization", "Bearer test-key")
      .send({ status: "paid-and-shipped" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("validation_error");
  });

  it("requires an explicit location for public API order creation", async () => {
    const app = await createV1App();

    const response = await request(app)
      .post(`/v1/orgs/${orgId}/orders`)
      .set("Authorization", "Bearer test-key")
      .send({
        lines: [{ productId: "123e4567-e89b-12d3-a456-426614174222", quantity: 1, unitPrice: 10 }],
        paymentMethod: "cash",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("validation_error");
    expect(response.body.message).toContain("locationId");
  });
});
