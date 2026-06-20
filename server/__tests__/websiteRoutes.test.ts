import type { RequestHandler } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createWebsiteAdminHandlers,
  createWebsitePublicHandlers,
  requireWebsiteStaffRole,
} from "../routes/website";
import { WebsitePublicOrderError, type WebsiteOrderRuntime } from "../services/website";

const recordAdminAuditMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../adminAudit", () => ({
  recordAdminAudit: recordAdminAuditMock,
}));

const ORG_ID = "00000000-0000-4000-8000-000000000001";

function createService() {
  return {
    getPublicSiteConfig: vi.fn().mockResolvedValue({ theme: { siteName: "WM Supplies" } }),
    getSiteConfig: vi.fn().mockResolvedValue({ blocks: [{ id: "hidden", isVisible: false }] }),
    listPublicProducts: vi.fn().mockResolvedValue([{ id: "prod-1", name: "Cups" }]),
    updateTheme: vi.fn().mockResolvedValue({ orgId: ORG_ID, siteName: "WM Supplies" }),
    updateOrderSettings: vi.fn().mockResolvedValue({ orgId: ORG_ID, orderAccessMode: "public" }),
    upsertBlock: vi.fn().mockResolvedValue({ id: "block-1", type: "hero" }),
    createUpload: vi.fn().mockResolvedValue({ id: "file-1", publicUrl: "/uploads/file.webp" }),
    validateThemePatch: vi.fn(),
    validateBlockInput: vi.fn(),
    validateUploadMetadata: vi.fn(),
    validateOrderSettingsPatch: vi.fn(),
    validatePublicOrder: vi.fn(),
    submitPublicOrder: vi.fn().mockResolvedValue({ orderId: "order-1", eventId: "event-1" }),
  };
}

function createOrderRuntime(): WebsiteOrderRuntime {
  return {
    withTransaction: vi.fn(async (fn) => fn({})),
    engine: {
      createCustomer: vi.fn().mockResolvedValue({ id: "customer-1" }),
      placeOrder: vi.fn().mockResolvedValue({ orderId: "order-1", warnings: [] }),
    },
    publishOrderCreated: vi.fn().mockResolvedValue("event-1"),
    loadCreatedOrder: vi.fn().mockResolvedValue(null),
  };
}

function mockReqRes(params: {
  query?: Record<string, unknown>;
  body?: unknown;
  user?: Record<string, unknown>;
  orgContext?: Record<string, unknown>;
} = {}) {
  const req = {
    query: params.query ?? {},
    body: params.body,
    user: params.user,
    orgContext: params.orgContext,
    get: vi.fn(),
  };
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status: vi.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: vi.fn((body: unknown) => {
      res.body = body;
      return res;
    }),
  };
  return { req, res };
}

async function run(handler: RequestHandler, req: any, res: any) {
  await Promise.resolve(handler(req, res, vi.fn()));
}

function adminReqRes(body?: unknown, query?: Record<string, unknown>) {
  return mockReqRes({
    body,
    query,
    user: { id: "user-1", role: "ADMIN" },
    orgContext: { orgId: ORG_ID, role: "ADMIN" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.WM_SUPPLIES_ORG_ID;
  delete process.env.WM_SUPPLIES_WEBSITE_ORG_ID;
});

describe("website public handlers", () => {
  it("returns public site config using configured org id", async () => {
    process.env.WM_SUPPLIES_ORG_ID = ORG_ID;
    const service = createService();
    const handlers = createWebsitePublicHandlers(service as any);
    const { req, res } = mockReqRes({ query: { page: "home" } });

    await run(handlers.getSiteConfig, req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ theme: { siteName: "WM Supplies" } });
    expect(service.getPublicSiteConfig).toHaveBeenCalledWith(ORG_ID, "home");
  });

  it("supports the brief's /api/public/products endpoint handler", async () => {
    process.env.WM_SUPPLIES_ORG_ID = ORG_ID;
    const service = createService();
    const handlers = createWebsitePublicHandlers(service as any);
    const { req, res } = mockReqRes({ query: { org: "wm-supplies" } });

    await run(handlers.getProducts, req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([{ id: "prod-1", name: "Cups" }]);
    expect(service.listPublicProducts).toHaveBeenCalledWith(ORG_ID);
  });

  it("returns 400 when no public org id is configured", async () => {
    const service = createService();
    const handlers = createWebsitePublicHandlers(service as any);
    const { req, res } = mockReqRes();

    await run(handlers.getProducts, req, res);

    expect(res.statusCode).toBe(400);
    expect(service.listPublicProducts).not.toHaveBeenCalled();
  });

  it("creates a public website order through the injected runtime", async () => {
    process.env.WM_SUPPLIES_ORG_ID = ORG_ID;
    const service = createService();
    const runtime = createOrderRuntime();
    const handlers = createWebsitePublicHandlers(service as any, runtime);
    const body = {
      customer: { name: "Ada Buyer" },
      items: [{ productId: "00000000-0000-4000-8000-000000000010", quantity: 2 }],
    };
    const { req, res } = mockReqRes({ body });

    await run(handlers.createOrder, req, res);

    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ orderId: "order-1", eventId: "event-1" });
    expect(service.submitPublicOrder).toHaveBeenCalledWith(ORG_ID, body, runtime);
  });

  it("turns public order validation and access errors into HTTP responses", async () => {
    process.env.WM_SUPPLIES_ORG_ID = ORG_ID;
    const runtime = createOrderRuntime();
    const invalidService = createService();
    invalidService.submitPublicOrder.mockRejectedValueOnce(
      new z.ZodError([
        {
          code: "custom",
          path: ["items"],
          message: "At least one item is required",
        },
      ]),
    );
    const invalidHandlers = createWebsitePublicHandlers(invalidService as any, runtime);
    const invalid = mockReqRes({ body: { customer: { name: "Ada" }, items: [] } });

    await run(invalidHandlers.createOrder, invalid.req, invalid.res);

    expect(invalid.res.statusCode).toBe(400);
    expect((invalid.res.body as { message: string }).message).toBe("Invalid website payload");

    const lockedService = createService();
    lockedService.submitPublicOrder.mockRejectedValueOnce(
      new WebsitePublicOrderError(409, "One or more products do not have enough stock"),
    );
    const lockedHandlers = createWebsitePublicHandlers(lockedService as any, runtime);
    const locked = mockReqRes({ body: { customer: { name: "Ada" }, items: [] } });

    await run(lockedHandlers.createOrder, locked.req, locked.res);

    expect(locked.res.statusCode).toBe(409);
    expect((locked.res.body as { message: string }).message).toBe(
      "One or more products do not have enough stock",
    );
  });
});

describe("website admin handlers", () => {
  it("loads admin config with hidden blocks included", async () => {
    const service = createService();
    const handlers = createWebsiteAdminHandlers(service as any);
    const { req, res } = adminReqRes(undefined, { page: "home" });

    await run(handlers.getConfig, req, res);

    expect(res.statusCode).toBe(200);
    expect(service.getSiteConfig).toHaveBeenCalledWith(ORG_ID, "home", {
      includeHiddenBlocks: true,
    });
  });

  it("updates theme settings and records audit", async () => {
    const service = createService();
    const handlers = createWebsiteAdminHandlers(service as any);
    const body = { siteName: "WM Supplies", primaryColor: "#FACC15" };
    const { req, res } = adminReqRes(body);

    await run(handlers.updateTheme, req, res);

    expect(res.statusCode).toBe(200);
    expect(service.updateTheme).toHaveBeenCalledWith(ORG_ID, body, "user-1");
    expect(recordAdminAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "website.theme.updated", orgId: ORG_ID }),
    );
  });

  it("turns validation errors into 400 responses", async () => {
    const service = createService();
    service.updateTheme.mockRejectedValueOnce(
      new z.ZodError([
        {
          code: "custom",
          path: ["primaryColor"],
          message: "Use a hex colour",
        },
      ]),
    );
    const handlers = createWebsiteAdminHandlers(service as any);
    const { req, res } = adminReqRes({ primaryColor: "yellow" });

    await run(handlers.updateTheme, req, res);

    expect(res.statusCode).toBe(400);
    expect((res.body as { message: string }).message).toBe("Invalid website payload");
  });

  it("creates blocks and upload metadata through scoped admin handlers", async () => {
    const service = createService();
    const handlers = createWebsiteAdminHandlers(service as any);
    const blockBody = { type: "hero", title: "Hello" };
    const block = adminReqRes(blockBody);

    await run(handlers.createBlock, block.req, block.res);

    expect(block.res.statusCode).toBe(201);
    expect(service.upsertBlock).toHaveBeenCalledWith(ORG_ID, blockBody, "user-1");

    const uploadBody = {
      publicUrl: "/uploads/website/file.webp",
      fileName: "file.webp",
      mimeType: "image/webp",
      byteSize: 100,
    };
    const upload = adminReqRes(uploadBody);

    await run(handlers.createUploadMetadata, upload.req, upload.res);

    expect(upload.res.statusCode).toBe(201);
    expect(service.createUpload).toHaveBeenCalledWith(ORG_ID, uploadBody, "user-1");
  });

  it("requires a staff role before admin handlers are mounted", async () => {
    const middleware = requireWebsiteStaffRole();
    const cashier = mockReqRes({ user: { id: "user-2", role: "CASHIER" } });
    const next = vi.fn();

    await Promise.resolve(middleware(cashier.req as any, cashier.res as any, next));

    expect(cashier.res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
});
