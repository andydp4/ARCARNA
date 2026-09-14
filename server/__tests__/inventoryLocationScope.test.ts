import type { RequestHandler } from "express";
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * ARC-042: a goods receipt into a location other than the caller's own
 * resolved one was always correct in product_location_stock, but nothing in
 * GET /api/inventory could ever surface it — the endpoint always resolved
 * exactly one location from the caller's own context (own default, order,
 * user default, or org default) with no way to ask for a different one.
 * `?locationId=` now lets a MANAGER+ view any of the org's locations, or the
 * org-wide total via `all`; every other caller keeps the previous behaviour.
 */

const getProductsWithStockMock = vi.hoisted(() => vi.fn());
const resolveEditableStockLocationIdMock = vi.hoisted(() => vi.fn());
const resolveStockLocationIdMock = vi.hoisted(() => vi.fn());

class FakeStockError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

vi.mock("../storage", () => ({
  storage: { getProductsWithStock: getProductsWithStockMock },
  AmbiguousStockLocationError: class extends Error {},
}));

vi.mock("../services/stockLocationContext", () => ({
  resolveEditableStockLocationId: resolveEditableStockLocationIdMock,
}));

vi.mock("../services/productLocationStock", () => ({
  StockError: FakeStockError,
  stockErrorPayload: (err: unknown) => ({
    code: err instanceof FakeStockError ? err.code : "INTERNAL_ERROR",
    message: err instanceof Error ? err.message : "error",
  }),
  resolveStockLocationId: resolveStockLocationIdMock,
}));

const { registerInventoryRoutes } = await import("../routes/inventory");

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const OWN_LOCATION_ID = "00000000-0000-4000-8000-0000000000aa";
const OTHER_LOCATION_ID = "00000000-0000-4000-8000-0000000000bb";

/** Registers the routes against a stub app and returns the GET /api/inventory handler. */
function getInventoryHandler() {
  let handler: RequestHandler | undefined;
  const app = {
    get: (path: string, ...handlers: RequestHandler[]) => {
      if (path === "/api/inventory") handler = handlers[handlers.length - 1];
    },
    patch: () => {},
  };
  registerInventoryRoutes(app as never, []);
  if (!handler) throw new Error("GET /api/inventory was not registered");
  return handler;
}

async function callAs(role: string, query: Record<string, string> = {}) {
  const handler = getInventoryHandler();
  const json = vi.fn();
  const res = { json, status: vi.fn().mockReturnThis() };
  const req = {
    orgContext: { orgId: ORG_ID, locationId: OWN_LOCATION_ID, role },
    query,
    user: { claims: { sub: "user-1" } },
  };
  await handler(req as never, res as never, vi.fn());
  return { json, res };
}

describe("GET /api/inventory location scope", () => {
  beforeEach(() => {
    getProductsWithStockMock.mockReset().mockResolvedValue([{ id: "p1", stock: 5 }]);
    resolveEditableStockLocationIdMock.mockReset().mockResolvedValue(OWN_LOCATION_ID);
    resolveStockLocationIdMock.mockReset().mockResolvedValue(OTHER_LOCATION_ID);
  });

  it("with no locationId query param, resolves the caller's own location exactly as before", async () => {
    const { json } = await callAs("MANAGER");
    expect(resolveEditableStockLocationIdMock).toHaveBeenCalledWith({
      orgId: ORG_ID,
      locationId: OWN_LOCATION_ID,
      userId: "user-1",
    });
    expect(resolveStockLocationIdMock).not.toHaveBeenCalled();
    expect(getProductsWithStockMock).toHaveBeenCalledWith(ORG_ID, OWN_LOCATION_ID);
    expect(json).toHaveBeenCalledWith([{ id: "p1", stock: 5 }]);
  });

  it.each(["MANAGER", "ADMIN", "SUPER_ADMIN"])(
    "lets a %s explicitly view a different location's stock",
    async (role) => {
      await callAs(role, { locationId: OTHER_LOCATION_ID });
      expect(resolveStockLocationIdMock).toHaveBeenCalledWith({
        orgId: ORG_ID,
        locationId: OTHER_LOCATION_ID,
      });
      expect(resolveEditableStockLocationIdMock).not.toHaveBeenCalled();
      expect(getProductsWithStockMock).toHaveBeenCalledWith(ORG_ID, OTHER_LOCATION_ID);
    },
  );

  it("ignores an explicit locationId from a role below MANAGER and falls back to its own resolved location", async () => {
    await callAs("CASHIER", { locationId: OTHER_LOCATION_ID });
    expect(resolveStockLocationIdMock).not.toHaveBeenCalled();
    expect(resolveEditableStockLocationIdMock).toHaveBeenCalledWith({
      orgId: ORG_ID,
      locationId: OWN_LOCATION_ID,
      userId: "user-1",
    });
    expect(getProductsWithStockMock).toHaveBeenCalledWith(ORG_ID, OWN_LOCATION_ID);
  });

  it("returns the org-wide total when a MANAGER+ asks for 'all'", async () => {
    await callAs("ADMIN", { locationId: "all" });
    expect(resolveStockLocationIdMock).not.toHaveBeenCalled();
    expect(resolveEditableStockLocationIdMock).not.toHaveBeenCalled();
    expect(getProductsWithStockMock).toHaveBeenCalledWith(ORG_ID, null);
  });

  it("answers 404 rather than silently falling back when the explicit location does not belong to the org", async () => {
    resolveStockLocationIdMock.mockRejectedValueOnce(
      new FakeStockError("LOCATION_NOT_FOUND", "Location not found for org"),
    );
    const { res, json } = await callAs("MANAGER", { locationId: "not-a-real-location" });
    expect(res.status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "LOCATION_NOT_FOUND" }),
    );
  });
});
