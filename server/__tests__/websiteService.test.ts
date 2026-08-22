import { describe, expect, it, vi } from "vitest";
import {
  buildPublicSiteConfig,
  createWebsiteService,
  normalizeWebsiteBlocks,
  projectPublicProduct,
  projectPublicProducts,
  resolvePublicOrderLines,
  WebsitePublicOrderError,
  type WebsiteOrderRuntime,
  type WebsiteRepository,
} from "../services/website";

function repo(overrides: Partial<WebsiteRepository> = {}): WebsiteRepository {
  return {
    getOrg: vi.fn().mockResolvedValue({ id: "org-1", name: "Arcana Org", tradingName: "WM Supplies" }),
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
    listWebsiteOrderProducts: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function runtime(): WebsiteOrderRuntime {
  return {
    withTransaction: vi.fn(async (fn) => fn({ tx: true })),
    getOrgTaxRatePercent: vi.fn().mockResolvedValue(undefined),
    engine: {
      createCustomer: vi.fn().mockResolvedValue({ id: "customer-1" }),
      placeOrder: vi.fn().mockResolvedValue({ orderId: "order-1", warnings: [] }),
    },
    publishOrderCreated: vi.fn().mockResolvedValue("event-1"),
    loadCreatedOrder: vi.fn().mockResolvedValue({
      id: "order-1",
      status: "pending",
      total: "36.00",
      paymentMethod: "transfer",
      customerId: "customer-1",
      items: [
        {
          id: "line-1",
          productId: "00000000-0000-4000-8000-000000000001",
          quantity: 2,
          unitPrice: "15.00",
          totalPrice: "30.00",
        },
      ],
    }),
  };
}

describe("website validation", () => {
  it("accepts safe theme colours and rejects unsafe CTA links", () => {
    const service = createWebsiteService(repo());

    expect(service.validateThemePatch({ primaryColor: "#FACC15" })).toEqual({
      primaryColor: "#FACC15",
    });

    expect(() =>
      service.validateBlockInput({
        type: "hero",
        ctaLink: "javascript:alert(1)",
      }),
    ).toThrow(/relative, http, https, mailto, or tel/i);
  });

  it("rejects oversized or non-image upload metadata", () => {
    const service = createWebsiteService(repo());

    expect(() =>
      service.validateUploadMetadata({
        publicUrl: "/uploads/file.exe",
        fileName: "file.exe",
        mimeType: "application/x-msdownload",
        byteSize: 100,
      }),
    ).toThrow();

    expect(() =>
      service.validateUploadMetadata({
        publicUrl: "/uploads/image.webp",
        fileName: "image.webp",
        mimeType: "image/webp",
        byteSize: 11 * 1024 * 1024,
      }),
    ).toThrow();
  });

  it("validates public order payloads and rejects client-supplied totals", () => {
    const service = createWebsiteService(repo());
    const parsed = service.validatePublicOrder({
      customer: { name: "Ada Buyer", email: "ada@example.com" },
      items: [{ productId: "00000000-0000-4000-8000-000000000001", quantity: 2 }],
    });

    expect(parsed.items[0].quantity).toBe(2);
    expect(() =>
      service.validatePublicOrder({
        customer: { name: "Ada Buyer", email: "ada@example.com" },
        items: [{ productId: "00000000-0000-4000-8000-000000000001", quantity: 2 }],
        total: 0,
      }),
    ).toThrow();
  });

  it("validates non-empty block patches with existing block safety rules", () => {
    const service = createWebsiteService(repo());

    expect(service.validateBlockPatch({ isVisible: false, sortOrder: 20 })).toEqual({
      isVisible: false,
      sortOrder: 20,
    });

    expect(() => service.validateBlockPatch({})).toThrow(/at least one/i);
    expect(() => service.validateBlockPatch({ ctaLink: "javascript:alert(1)" })).toThrow(
      /relative, http, https, mailto, or tel/i,
    );
  });
});

describe("website config projection", () => {
  it("builds default config when no backend rows exist", () => {
    const config = buildPublicSiteConfig({ orgName: "WM Supplies" });

    expect(config.theme.siteName).toBe("WM Supplies");
    expect(config.theme.primaryColor).toBe("#ff2bd6");
    expect(config.orderSettings.orderAccessMode).toBe("public");
    expect(config.blocks).toEqual([]);
  });

  it("filters hidden blocks and sorts visible blocks by sort order", () => {
    const blocks = normalizeWebsiteBlocks([
      { id: "block-c", page: "home", type: "cta", sortOrder: 30, isVisible: true },
      { id: "block-hidden", page: "home", type: "notice", sortOrder: 10, isVisible: false },
      { id: "block-a", page: "home", type: "hero", sortOrder: 10, isVisible: true },
    ]);

    expect(blocks.map((block) => block.id)).toEqual(["block-a", "block-c"]);
  });

  it("can include hidden blocks for admin preview mode", () => {
    const blocks = normalizeWebsiteBlocks(
      [
        { id: "block-hidden", page: "home", type: "notice", sortOrder: 10, isVisible: false },
        { id: "block-visible", page: "home", type: "hero", sortOrder: 20, isVisible: true },
      ],
      { includeHidden: true },
    );

    expect(blocks.map((block) => block.id)).toEqual(["block-hidden", "block-visible"]);
  });

  it("loads public site config through the repository", async () => {
    const repository = repo({
      getThemeSettings: vi.fn().mockResolvedValue({ orgId: "org-1", siteName: null }),
      listBlocks: vi.fn().mockResolvedValue([
        { id: "visible", page: "home", type: "hero", sortOrder: 1, isVisible: true },
        { id: "hidden", page: "home", type: "cta", sortOrder: 2, isVisible: false },
      ]),
    });
    const service = createWebsiteService(repository);

    const config = await service.getPublicSiteConfig("org-1");

    expect(config.theme.siteName).toBe("WM Supplies");
    expect(config.blocks.map((block) => block.id)).toEqual(["visible"]);
    expect(repository.listBlocks).toHaveBeenCalledWith("org-1", "home");
  });

  it("updates, duplicates, deletes, and lists website admin content through the repository", async () => {
    const repository = repo({
      updateBlock: vi.fn().mockResolvedValue({
        id: "00000000-0000-4000-8000-000000000101",
        page: "home",
        type: "hero",
        sortOrder: 0,
        isVisible: false,
      }),
      duplicateBlock: vi.fn().mockResolvedValue({
        id: "00000000-0000-4000-8000-000000000102",
        page: "home",
        type: "hero",
        sortOrder: 1,
        isVisible: false,
      }),
      deleteBlock: vi.fn().mockResolvedValue(true),
      listUploads: vi.fn().mockResolvedValue([
        {
          id: "00000000-0000-4000-8000-000000000201",
          provider: "local",
          publicUrl: "/uploads/hero.webp",
          fileName: "hero.webp",
          mimeType: "image/webp",
          byteSize: 100,
          status: "available",
        },
      ]),
    });
    const service = createWebsiteService(repository);

    await expect(
      service.updateBlock(
        "org-1",
        "00000000-0000-4000-8000-000000000101",
        { isVisible: false },
        "user-1",
      ),
    ).resolves.toMatchObject({ isVisible: false });
    await expect(
      service.duplicateBlock("org-1", "00000000-0000-4000-8000-000000000101", "user-1"),
    ).resolves.toMatchObject({ id: "00000000-0000-4000-8000-000000000102" });
    await expect(
      service.deleteBlock("org-1", "00000000-0000-4000-8000-000000000101"),
    ).resolves.toBe(true);
    await expect(service.listUploads("org-1")).resolves.toHaveLength(1);

    expect(repository.updateBlock).toHaveBeenCalledWith(
      "org-1",
      "00000000-0000-4000-8000-000000000101",
      { isVisible: false, updatedBy: "user-1" },
    );
  });
});

describe("public website order submission", () => {
  const productId = "00000000-0000-4000-8000-000000000001";

  it("server-resolves product prices and ignores browser totals", async () => {
    const repository = repo({
      listWebsiteOrderProducts: vi.fn().mockResolvedValue([
        {
          id: productId,
          productId: "SKU-1",
          name: "Cups",
          defaultSalePrice: "15.00",
          availableForWebsite: true,
          stock: 10,
        },
      ]),
    });
    const service = createWebsiteService(repository);
    const orderRuntime = runtime();

    const result = await service.submitPublicOrder(
      "org-1",
      {
        customer: { name: "Ada Buyer", email: "ada@example.com" },
        fulfilment: { method: "pickup" },
        items: [{ productId, quantity: 2 }],
      },
      orderRuntime,
    );

    expect(result).toMatchObject({ orderId: "order-1", eventId: "event-1", total: 36 });
    expect(orderRuntime.engine.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "web",
        paymentMethod: "transfer",
        lines: [{ productId, quantity: 2, unitPrice: 15 }],
      }),
    );
    expect(orderRuntime.engine.createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ source: "website", name: "Ada Buyer" }),
    );
  });

  it("passes the org's tax rate to the engine, and omits it when the org has none", async () => {
    // Without this the engine falls back to DEFAULT_TAX_RATE_PERCENT (20) and
    // every website order is taxed at a rate the org may not charge — while
    // the till, which does pass the rate, charges the right one.
    const repository = repo({
      listWebsiteOrderProducts: vi.fn().mockResolvedValue([
        {
          id: productId,
          productId: "SKU-1",
          name: "Cups",
          defaultSalePrice: "15.00",
          availableForWebsite: true,
          stock: 10,
        },
      ]),
    });
    const service = createWebsiteService(repository);
    const order = {
      customer: { name: "Ada Buyer", email: "ada@example.com" },
      fulfilment: { method: "pickup" as const },
      items: [{ productId, quantity: 2 }],
    };

    const configured = runtime();
    configured.getOrgTaxRatePercent = vi.fn().mockResolvedValue(5);
    await service.submitPublicOrder("org-1", order, configured);
    expect(configured.getOrgTaxRatePercent).toHaveBeenCalledWith("org-1");
    expect(configured.engine.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({ taxRatePercent: 5 }),
    );

    // An org with no configured rate must send no key at all, so the engine
    // applies its own default rather than being handed an undefined rate.
    const unset = runtime();
    unset.getOrgTaxRatePercent = vi.fn().mockResolvedValue(undefined);
    await service.submitPublicOrder("org-1", order, unset);
    expect(unset.engine.placeOrder).toHaveBeenCalledWith(
      expect.not.objectContaining({ taxRatePercent: expect.anything() }),
    );
  });

  it("rejects unavailable products, stock shortages, and minimum order misses", () => {
    expect(() =>
      resolvePublicOrderLines({
        requestedItems: [{ productId, quantity: 1 }],
        products: [],
        settings: {
          orderAccessMode: "public",
          defaultOrderStatus: "pending",
          defaultLocationId: null,
          allowOutOfStockOrders: false,
          minOrderValue: null,
          orderIntroText: null,
          successMessage: null,
          notificationEmail: null,
        },
      }),
    ).toThrow(WebsitePublicOrderError);

    expect(() =>
      resolvePublicOrderLines({
        requestedItems: [{ productId, quantity: 3 }],
        products: [
          {
            id: productId,
            productId: "SKU-1",
            name: "Cups",
            defaultSalePrice: "5.00",
            availableForWebsite: true,
            stock: 2,
          },
        ],
        settings: {
          orderAccessMode: "public",
          defaultOrderStatus: "pending",
          defaultLocationId: null,
          allowOutOfStockOrders: false,
          minOrderValue: null,
          orderIntroText: null,
          successMessage: null,
          notificationEmail: null,
        },
      }),
    ).toThrow(/enough stock/);

    expect(() =>
      resolvePublicOrderLines({
        requestedItems: [{ productId, quantity: 1 }],
        products: [
          {
            id: productId,
            productId: "SKU-1",
            name: "Cups",
            defaultSalePrice: "5.00",
            availableForWebsite: true,
            stock: 10,
          },
        ],
        settings: {
          orderAccessMode: "public",
          defaultOrderStatus: "pending",
          defaultLocationId: null,
          allowOutOfStockOrders: false,
          minOrderValue: 10,
          orderIntroText: null,
          successMessage: null,
          notificationEmail: null,
        },
      }),
    ).toThrow(/Minimum order value/);
  });

  it("enforces password and clerk order access modes before creating an order", async () => {
    const repository = repo({
      getOrderSettings: vi.fn().mockResolvedValue({
        orgId: "org-1",
        orderAccessMode: "password",
      }),
    });
    const service = createWebsiteService(repository);
    const orderRuntime = runtime();

    process.env.WM_SUPPLIES_ORDER_PASSWORD = "let-me-in";
    await expect(
      service.submitPublicOrder(
        "org-1",
        {
          customer: { name: "Ada Buyer" },
          items: [{ productId, quantity: 1 }],
          accessPassword: "wrong",
        },
        orderRuntime,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });

    const clerkService = createWebsiteService(
      repo({
        getOrderSettings: vi.fn().mockResolvedValue({
          orgId: "org-1",
          orderAccessMode: "clerk",
        }),
      }),
    );
    await expect(
      clerkService.submitPublicOrder(
        "org-1",
        {
          customer: { name: "Ada Buyer" },
          items: [{ productId, quantity: 1 }],
        },
        orderRuntime,
      ),
    ).rejects.toMatchObject({ statusCode: 401 });

    delete process.env.WM_SUPPLIES_ORDER_PASSWORD;
    expect(orderRuntime.engine.placeOrder).not.toHaveBeenCalled();
  });
});

describe("public product projection", () => {
  it("hides products not enabled for the website", () => {
    expect(
      projectPublicProduct({
        id: "prod-1",
        productId: "SKU-1",
        name: "Hidden",
        defaultSalePrice: "9.99",
        availableForWebsite: false,
        costPrice: "1.00",
      }),
    ).toBeNull();
  });

  it("projects only customer-safe product fields", () => {
    const projected = projectPublicProduct({
      id: "prod-1",
      productId: "SKU-1",
      name: "Internal name",
      defaultSalePrice: "9.99",
      availableForWebsite: true,
      websiteTitle: "Website name",
      websiteDescription: "A good thing",
      websiteCategory: "Drinks",
      websiteUnitLabel: "case",
      websiteSortOrder: 2,
      websiteImageFileId: "file-1",
      websiteImageUrl: "/uploads/product.webp",
      costPrice: "1.00",
      stock: 5,
    });

    expect(projected).toEqual({
      id: "prod-1",
      sku: "SKU-1",
      name: "Website name",
      description: "A good thing",
      category: "Drinks",
      unitLabel: "case",
      price: 9.99,
      image: { id: "file-1", url: "/uploads/product.webp", altText: null },
      sortOrder: 2,
      inStock: true,
    });
    expect(projected && "costPrice" in projected).toBe(false);
  });

  it("sorts projected products by website sort order then name", () => {
    const products = projectPublicProducts([
      {
        id: "prod-b",
        productId: "B",
        name: "Bananas",
        defaultSalePrice: "1.00",
        availableForWebsite: true,
        websiteSortOrder: 20,
      },
      {
        id: "prod-a",
        productId: "A",
        name: "Apples",
        defaultSalePrice: "1.00",
        availableForWebsite: true,
        websiteSortOrder: 10,
      },
    ]);

    expect(products.map((product) => product.sku)).toEqual(["A", "B"]);
  });
});
