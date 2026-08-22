import { resolveAppPath, resolveApiUrl } from "@/lib/appPaths";
import type { CSSProperties } from "react";

export type WebsiteBlockType =
  | "hero"
  | "image"
  | "wide"
  | "split"
  | "cta"
  | "notice"
  | "gallery"
  | "spacer";

export interface WebsiteImage {
  id: string;
  url: string | null;
  altText: string | null;
}

export interface PublicWebsiteTheme {
  siteName: string;
  logoUrl?: string | null;
  faviconUrl?: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  borderColor: string;
  buttonBackgroundColor: string;
  buttonTextColor: string;
  headingFont?: string | null;
  bodyFont?: string | null;
  customCss?: string | null;
}

export interface PublicWebsiteOrderSettings {
  orderAccessMode: "public" | "password" | "clerk";
  defaultOrderStatus: string;
  defaultLocationId: string | null;
  allowOutOfStockOrders: boolean;
  minOrderValue: number | null;
  orderIntroText: string | null;
  successMessage: string | null;
  notificationEmail: string | null;
}

export interface PublicWebsiteBlock {
  id: string;
  page: string;
  type: WebsiteBlockType;
  sortOrder: number;
  isVisible: boolean;
  title: string | null;
  subtitle: string | null;
  body: string | null;
  ctaLabel: string | null;
  ctaLink: string | null;
  image: WebsiteImage | null;
  colors: {
    backgroundColor: string | null;
    textColor: string | null;
    borderColor: string | null;
    buttonBackgroundColor: string | null;
    buttonTextColor: string | null;
    overlayColor: string | null;
    overlayOpacity: number;
  };
  imageFit: "cover" | "contain" | "fill";
  content: Record<string, unknown>;
}

export interface PublicSiteConfig {
  theme: PublicWebsiteTheme;
  orderSettings: PublicWebsiteOrderSettings;
  blocks: PublicWebsiteBlock[];
}

export interface PublicWebsiteProduct {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  unitLabel: string | null;
  price: number;
  image: WebsiteImage | null;
  sortOrder: number;
  inStock: boolean | null;
}

export interface WebsiteCartLine {
  productId: string;
  quantity: number;
}

export const fallbackWebsiteTheme: PublicWebsiteTheme = {
  siteName: "WM Supplies",
  logoUrl: null,
  faviconUrl: null,
  primaryColor: "#ff2bd6",
  secondaryColor: "#00d4ff",
  accentColor: "#ffe600",
  backgroundColor: "#111111",
  textColor: "#ffffff",
  borderColor: "#ffffff",
  buttonBackgroundColor: "#ffe600",
  buttonTextColor: "#111111",
  headingFont: null,
  bodyFont: null,
  customCss: null,
};

export const fallbackOrderSettings: PublicWebsiteOrderSettings = {
  orderAccessMode: "public",
  defaultOrderStatus: "pending",
  defaultLocationId: null,
  allowOutOfStockOrders: false,
  minOrderValue: null,
  orderIntroText: null,
  successMessage: null,
  notificationEmail: null,
};

export const fallbackSiteConfig: PublicSiteConfig = {
  theme: fallbackWebsiteTheme,
  orderSettings: fallbackOrderSettings,
  blocks: [],
};

export function buildFallbackBlocks(theme: PublicWebsiteTheme): PublicWebsiteBlock[] {
  return [
    {
      id: "fallback-hero",
      page: "home",
      type: "hero",
      sortOrder: 0,
      isVisible: true,
      title: `${theme.siteName} for fast local supplies`,
      subtitle: "Cleaning, catering, paper goods and everyday essentials.",
      body: null,
      ctaLabel: "Order now",
      ctaLink: "/order",
      image: null,
      colors: {
        backgroundColor: theme.primaryColor,
        textColor: "#111111",
        borderColor: theme.borderColor,
        buttonBackgroundColor: theme.accentColor,
        buttonTextColor: "#111111",
        overlayColor: null,
        overlayOpacity: 0,
      },
      imageFit: "cover",
      content: {},
    },
    {
      id: "fallback-split",
      page: "home",
      type: "split",
      sortOrder: 10,
      isVisible: true,
      title: "Supply highlights",
      subtitle: "Promos, notices and local stock",
      body: "Check the latest offers, then send the team your list for pickup or delivery confirmation.",
      ctaLabel: "View order page",
      ctaLink: "/order",
      image: null,
      colors: {
        backgroundColor: theme.secondaryColor,
        textColor: "#061017",
        borderColor: theme.borderColor,
        buttonBackgroundColor: "#111111",
        buttonTextColor: "#ffffff",
        overlayColor: null,
        overlayOpacity: 0,
      },
      imageFit: "cover",
      content: {},
    },
    {
      id: "fallback-cta",
      page: "home",
      type: "cta",
      sortOrder: 20,
      isVisible: true,
      title: "Ready for today's list?",
      subtitle: null,
      body: "Send a request and the WM Supplies team will pick it up.",
      ctaLabel: "Start an order",
      ctaLink: "/order",
      image: null,
      colors: {
        backgroundColor: theme.accentColor,
        textColor: "#111111",
        borderColor: theme.borderColor,
        buttonBackgroundColor: "#111111",
        buttonTextColor: "#ffffff",
        overlayColor: null,
        overlayOpacity: 0,
      },
      imageFit: "cover",
      content: {},
    },
  ];
}

export function getRenderableBlocks(config: PublicSiteConfig): PublicWebsiteBlock[] {
  if (config.blocks.length > 0) {
    return config.blocks.filter((block) => block.isVisible);
  }
  return buildFallbackBlocks(config.theme);
}

export function resolveWebsiteHref(href: string | null | undefined): string {
  const trimmed = href?.trim();
  if (!trimmed) return resolveAppPath("/");
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("tel:")
  ) {
    return trimmed;
  }
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return resolveAppPath(trimmed);
  }
  return resolveAppPath("/");
}

export function themeCssVars(theme: PublicWebsiteTheme): CSSProperties {
  return {
    "--wm-primary": theme.primaryColor,
    "--wm-secondary": theme.secondaryColor,
    "--wm-accent": theme.accentColor,
    "--wm-bg": theme.backgroundColor,
    "--wm-text": theme.textColor,
    "--wm-border": theme.borderColor,
    "--wm-button-bg": theme.buttonBackgroundColor,
    "--wm-button-text": theme.buttonTextColor,
  } as CSSProperties;
}

export function blockCssVars(
  block: PublicWebsiteBlock,
  theme: PublicWebsiteTheme,
): CSSProperties {
  return {
    "--wm-block-bg": block.colors.backgroundColor ?? theme.primaryColor,
    "--wm-block-text": block.colors.textColor ?? theme.textColor,
    "--wm-block-border": block.colors.borderColor ?? theme.borderColor,
    "--wm-block-button-bg": block.colors.buttonBackgroundColor ?? theme.buttonBackgroundColor,
    "--wm-block-button-text": block.colors.buttonTextColor ?? theme.buttonTextColor,
    "--wm-block-overlay": block.colors.overlayColor ?? "transparent",
    "--wm-block-overlay-opacity": String(block.colors.overlayOpacity ?? 0),
  } as CSSProperties;
}

export function formatWebsiteMoney(amount: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
  }).format(amount);
}

export function calculateCartTotal(
  products: PublicWebsiteProduct[],
  cart: WebsiteCartLine[],
): number {
  const productById = new Map(products.map((product) => [product.id, product]));
  return cart.reduce((total, line) => {
    const product = productById.get(line.productId);
    if (!product) return total;
    return total + product.price * line.quantity;
  }, 0);
}

export function normalizeCartLines(lines: WebsiteCartLine[]): WebsiteCartLine[] {
  return lines
    .filter((line) => line.quantity > 0)
    .map((line) => ({
      productId: line.productId,
      quantity: Math.min(999, Math.max(1, Math.trunc(line.quantity))),
    }));
}

export function publicWebsiteApiUrl(path: string): string {
  return resolveApiUrl(path);
}
