import { describe, expect, it, vi } from "vitest";
import {
  buildPublicSiteConfig,
  createWebsiteService,
  normalizeWebsiteBlocks,
  projectPublicProduct,
  projectPublicProducts,
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
    createUpload: vi.fn(),
    listPublicProducts: vi.fn().mockResolvedValue([]),
    ...overrides,
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
});

describe("website config projection", () => {
  it("builds default config when no backend rows exist", () => {
    const config = buildPublicSiteConfig({ orgName: "WM Supplies" });

    expect(config.theme.siteName).toBe("WM Supplies");
    expect(config.theme.primaryColor).toBe("#FACC15");
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
