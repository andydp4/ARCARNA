import { describe, expect, it } from "vitest";
import {
  blockCssVars,
  buildFallbackBlocks,
  calculateCartTotal,
  fallbackSiteConfig,
  formatWebsiteMoney,
  getRenderableBlocks,
  normalizeCartLines,
  resolveWebsiteHref,
  themeCssVars,
  type PublicWebsiteProduct,
} from "../publicWebsite";

const products: PublicWebsiteProduct[] = [
  {
    id: "prod-1",
    sku: "CUPS",
    name: "Cups",
    description: null,
    category: "Catering",
    unitLabel: "case",
    price: 12.5,
    image: null,
    sortOrder: 0,
    inStock: true,
  },
  {
    id: "prod-2",
    sku: "ROLLS",
    name: "Paper rolls",
    description: null,
    category: "Paper",
    unitLabel: "pack",
    price: 4,
    image: null,
    sortOrder: 1,
    inStock: true,
  },
];

describe("WM Supplies public website helpers", () => {
  it("uses backend blocks when visible blocks exist", () => {
    const blocks = getRenderableBlocks({
      ...fallbackSiteConfig,
      blocks: [
        {
          ...buildFallbackBlocks(fallbackSiteConfig.theme)[0],
          id: "configured",
          title: "Configured hero",
        },
      ],
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe("configured");
  });

  it("builds bold fallback blocks when the backend has no content yet", () => {
    const blocks = getRenderableBlocks(fallbackSiteConfig);

    expect(blocks.map((block) => block.type)).toEqual(["hero", "split", "cta"]);
    expect(blocks[0].ctaLink).toBe("/order");
  });

  it("resolves only safe public links into app paths or external URLs", () => {
    expect(resolveWebsiteHref("/order")).toBe("/arcarna/order");
    expect(resolveWebsiteHref("https://example.com")).toBe("https://example.com");
    expect(resolveWebsiteHref("javascript:alert(1)")).toBe("/arcarna/");
  });

  it("projects theme and block colours into CSS variables", () => {
    expect(themeCssVars(fallbackSiteConfig.theme)).toMatchObject({
      "--wm-primary": "#ff2bd6",
      "--wm-bg": "#111111",
    });

    const block = buildFallbackBlocks(fallbackSiteConfig.theme)[0];
    expect(blockCssVars(block, fallbackSiteConfig.theme)).toMatchObject({
      "--wm-block-bg": "#ff2bd6",
      "--wm-block-button-bg": "#ffe600",
    });
  });

  it("normalizes cart lines and calculates the product total", () => {
    const lines = normalizeCartLines([
      { productId: "prod-1", quantity: 2.8 },
      { productId: "prod-2", quantity: 0 },
      { productId: "missing", quantity: 3 },
    ]);

    expect(lines).toEqual([
      { productId: "prod-1", quantity: 2 },
      { productId: "missing", quantity: 3 },
    ]);
    expect(calculateCartTotal(products, lines)).toBe(25);
    expect(formatWebsiteMoney(25)).toBe("£25.00");
  });
});
