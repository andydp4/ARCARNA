import {
  publicWebsiteOrderSchema,
  websiteBlockInputSchema,
  websiteOrderSettingsPatchSchema,
  websiteThemePatchSchema,
  websiteUploadMetadataSchema,
  type WebsiteBlockInput,
  type WebsiteOrderSettingsPatch,
  type WebsiteThemePatch,
  type WebsiteUploadMetadata,
} from "@shared/website";

export interface WebsiteThemeRow {
  orgId: string;
  siteName: string | null;
  logoFileId?: string | null;
  logoUrl?: string | null;
  faviconFileId?: string | null;
  faviconUrl?: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  backgroundColor: string | null;
  textColor: string | null;
  borderColor: string | null;
  buttonBackgroundColor: string | null;
  buttonTextColor: string | null;
  headingFont?: string | null;
  bodyFont?: string | null;
  customCss?: string | null;
}

export interface WebsiteOrderSettingsRow {
  orgId: string;
  orderAccessMode: "public" | "password" | "clerk" | string | null;
  defaultOrderStatus: string | null;
  defaultLocationId?: string | null;
  allowOutOfStockOrders: boolean | null;
  minOrderValue?: string | number | null;
  orderIntroText?: string | null;
  successMessage?: string | null;
  notificationEmail?: string | null;
}

export interface WebsiteBlockRow {
  id: string;
  page: string;
  type: string;
  sortOrder: number;
  isVisible: boolean;
  title?: string | null;
  subtitle?: string | null;
  body?: string | null;
  ctaLabel?: string | null;
  ctaLink?: string | null;
  imageFileId?: string | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
  backgroundColor?: string | null;
  textColor?: string | null;
  borderColor?: string | null;
  buttonBackgroundColor?: string | null;
  buttonTextColor?: string | null;
  overlayColor?: string | null;
  overlayOpacity?: string | number | null;
  imageFit?: string | null;
  content?: Record<string, unknown> | null;
}

export interface WebsiteProductRow {
  id: string;
  productId: string;
  name: string;
  defaultSalePrice: string | number;
  availableForWebsite?: boolean | null;
  websiteTitle?: string | null;
  websiteDescription?: string | null;
  websiteCategory?: string | null;
  websiteUnitLabel?: string | null;
  websiteSortOrder?: number | null;
  websiteImageFileId?: string | null;
  websiteImageUrl?: string | null;
  websiteImageAlt?: string | null;
  stock?: number | null;
  costPrice?: string | number | null;
}

export interface WebsiteRepository {
  getOrg(orgId: string): Promise<{ id: string; name: string; tradingName?: string | null } | null>;
  getThemeSettings(orgId: string): Promise<WebsiteThemeRow | null>;
  upsertThemeSettings(
    orgId: string,
    patch: WebsiteThemePatch & { updatedBy?: string },
  ): Promise<WebsiteThemeRow>;
  getOrderSettings(orgId: string): Promise<WebsiteOrderSettingsRow | null>;
  upsertOrderSettings(
    orgId: string,
    patch: WebsiteOrderSettingsPatch & { updatedBy?: string },
  ): Promise<WebsiteOrderSettingsRow>;
  listBlocks(orgId: string, page: string): Promise<WebsiteBlockRow[]>;
  upsertBlock(
    orgId: string,
    block: WebsiteBlockInput & { updatedBy?: string },
  ): Promise<WebsiteBlockRow>;
  createUpload(
    orgId: string,
    upload: WebsiteUploadMetadata & { uploadedBy?: string },
  ): Promise<{ id: string; publicUrl: string }>;
  listPublicProducts(orgId: string): Promise<WebsiteProductRow[]>;
}

export const DEFAULT_WEBSITE_THEME = {
  siteName: "WM Supplies",
  logoFileId: null,
  logoUrl: null,
  faviconFileId: null,
  faviconUrl: null,
  primaryColor: "#FACC15",
  secondaryColor: "#111827",
  accentColor: "#EF4444",
  backgroundColor: "#FFFFFF",
  textColor: "#111827",
  borderColor: "#111827",
  buttonBackgroundColor: "#111827",
  buttonTextColor: "#FFFFFF",
  headingFont: null,
  bodyFont: null,
  customCss: null,
} as const;

export const DEFAULT_WEBSITE_ORDER_SETTINGS = {
  orderAccessMode: "public",
  defaultOrderStatus: "pending",
  defaultLocationId: null,
  allowOutOfStockOrders: false,
  minOrderValue: null,
  orderIntroText: null,
  successMessage: null,
  notificationEmail: null,
} as const;

function asNumber(value: string | number | null | undefined, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeWebsiteTheme(
  row: WebsiteThemeRow | null | undefined,
  orgName: string = DEFAULT_WEBSITE_THEME.siteName,
) {
  return {
    ...DEFAULT_WEBSITE_THEME,
    siteName: row?.siteName || orgName || DEFAULT_WEBSITE_THEME.siteName,
    logoFileId: row?.logoFileId ?? null,
    logoUrl: row?.logoUrl ?? null,
    faviconFileId: row?.faviconFileId ?? null,
    faviconUrl: row?.faviconUrl ?? null,
    primaryColor: row?.primaryColor || DEFAULT_WEBSITE_THEME.primaryColor,
    secondaryColor: row?.secondaryColor || DEFAULT_WEBSITE_THEME.secondaryColor,
    accentColor: row?.accentColor || DEFAULT_WEBSITE_THEME.accentColor,
    backgroundColor: row?.backgroundColor || DEFAULT_WEBSITE_THEME.backgroundColor,
    textColor: row?.textColor || DEFAULT_WEBSITE_THEME.textColor,
    borderColor: row?.borderColor || DEFAULT_WEBSITE_THEME.borderColor,
    buttonBackgroundColor:
      row?.buttonBackgroundColor || DEFAULT_WEBSITE_THEME.buttonBackgroundColor,
    buttonTextColor: row?.buttonTextColor || DEFAULT_WEBSITE_THEME.buttonTextColor,
    headingFont: row?.headingFont ?? null,
    bodyFont: row?.bodyFont ?? null,
    customCss: row?.customCss ?? null,
  };
}

export function normalizeWebsiteOrderSettings(row: WebsiteOrderSettingsRow | null | undefined) {
  return {
    ...DEFAULT_WEBSITE_ORDER_SETTINGS,
    orderAccessMode: row?.orderAccessMode || DEFAULT_WEBSITE_ORDER_SETTINGS.orderAccessMode,
    defaultOrderStatus: row?.defaultOrderStatus || DEFAULT_WEBSITE_ORDER_SETTINGS.defaultOrderStatus,
    defaultLocationId: row?.defaultLocationId ?? null,
    allowOutOfStockOrders:
      row?.allowOutOfStockOrders ?? DEFAULT_WEBSITE_ORDER_SETTINGS.allowOutOfStockOrders,
    minOrderValue:
      row?.minOrderValue === null || row?.minOrderValue === undefined
        ? null
        : asNumber(row.minOrderValue),
    orderIntroText: row?.orderIntroText ?? null,
    successMessage: row?.successMessage ?? null,
    notificationEmail: row?.notificationEmail ?? null,
  };
}

export function normalizeWebsiteBlocks(
  rows: WebsiteBlockRow[],
  options: { includeHidden?: boolean } = {},
) {
  return rows
    .filter((block) => options.includeHidden || block.isVisible)
    .sort((a, b) => {
      const sortDiff = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      return sortDiff === 0 ? a.id.localeCompare(b.id) : sortDiff;
    })
    .map((block) => ({
      id: block.id,
      page: block.page,
      type: block.type,
      sortOrder: block.sortOrder ?? 0,
      isVisible: block.isVisible,
      title: block.title ?? null,
      subtitle: block.subtitle ?? null,
      body: block.body ?? null,
      ctaLabel: block.ctaLabel ?? null,
      ctaLink: block.ctaLink ?? null,
      image: block.imageFileId
        ? {
            id: block.imageFileId,
            url: block.imageUrl ?? null,
            altText: block.imageAlt ?? null,
          }
        : null,
      colors: {
        backgroundColor: block.backgroundColor ?? null,
        textColor: block.textColor ?? null,
        borderColor: block.borderColor ?? null,
        buttonBackgroundColor: block.buttonBackgroundColor ?? null,
        buttonTextColor: block.buttonTextColor ?? null,
        overlayColor: block.overlayColor ?? null,
        overlayOpacity: asNumber(block.overlayOpacity, 0),
      },
      imageFit: block.imageFit ?? "cover",
      content: block.content ?? {},
    }));
}

export function projectPublicProduct(product: WebsiteProductRow) {
  if (!product.availableForWebsite) return null;

  return {
    id: product.id,
    sku: product.productId,
    name: product.websiteTitle || product.name,
    description: product.websiteDescription ?? null,
    category: product.websiteCategory ?? null,
    unitLabel: product.websiteUnitLabel ?? null,
    price: asNumber(product.defaultSalePrice),
    image: product.websiteImageFileId
      ? {
          id: product.websiteImageFileId,
          url: product.websiteImageUrl ?? null,
          altText: product.websiteImageAlt ?? null,
        }
      : null,
    sortOrder: product.websiteSortOrder ?? 0,
    inStock: product.stock === null || product.stock === undefined ? null : product.stock > 0,
  };
}

export function projectPublicProducts(products: WebsiteProductRow[]) {
  return products
    .map(projectPublicProduct)
    .filter((product): product is NonNullable<ReturnType<typeof projectPublicProduct>> =>
      Boolean(product),
    )
    .sort((a, b) => {
      const sortDiff = a.sortOrder - b.sortOrder;
      return sortDiff === 0 ? a.name.localeCompare(b.name) : sortDiff;
    });
}

export function buildPublicSiteConfig(params: {
  orgName?: string;
  theme?: WebsiteThemeRow | null;
  orderSettings?: WebsiteOrderSettingsRow | null;
  blocks?: WebsiteBlockRow[];
  includeHiddenBlocks?: boolean;
}) {
  return {
    theme: normalizeWebsiteTheme(params.theme, params.orgName),
    orderSettings: normalizeWebsiteOrderSettings(params.orderSettings),
    blocks: normalizeWebsiteBlocks(params.blocks ?? [], {
      includeHidden: params.includeHiddenBlocks,
    }),
  };
}

export function createWebsiteService(repository: WebsiteRepository) {
  return {
    validateThemePatch(input: unknown) {
      return websiteThemePatchSchema.parse(input);
    },

    validateBlockInput(input: unknown) {
      return websiteBlockInputSchema.parse(input);
    },

    validateUploadMetadata(input: unknown) {
      return websiteUploadMetadataSchema.parse(input);
    },

    validateOrderSettingsPatch(input: unknown) {
      return websiteOrderSettingsPatchSchema.parse(input);
    },

    validatePublicOrder(input: unknown) {
      return publicWebsiteOrderSchema.parse(input);
    },

    async getSiteConfig(
      orgId: string,
      page = "home",
      options: { includeHiddenBlocks?: boolean } = {},
    ) {
      const [org, theme, orderSettings, blocks] = await Promise.all([
        repository.getOrg(orgId),
        repository.getThemeSettings(orgId),
        repository.getOrderSettings(orgId),
        repository.listBlocks(orgId, page),
      ]);

      return buildPublicSiteConfig({
        orgName: org?.tradingName || org?.name,
        theme,
        orderSettings,
        blocks,
        includeHiddenBlocks: options.includeHiddenBlocks,
      });
    },

    async getPublicSiteConfig(orgId: string, page = "home") {
      return this.getSiteConfig(orgId, page, { includeHiddenBlocks: false });
    },

    async updateTheme(orgId: string, input: unknown, updatedBy?: string) {
      const patch = websiteThemePatchSchema.parse(input);
      return repository.upsertThemeSettings(orgId, { ...patch, updatedBy });
    },

    async updateOrderSettings(orgId: string, input: unknown, updatedBy?: string) {
      const patch = websiteOrderSettingsPatchSchema.parse(input);
      return repository.upsertOrderSettings(orgId, { ...patch, updatedBy });
    },

    async upsertBlock(orgId: string, input: unknown, updatedBy?: string) {
      const block = websiteBlockInputSchema.parse(input);
      return repository.upsertBlock(orgId, { ...block, updatedBy });
    },

    async createUpload(orgId: string, input: unknown, uploadedBy?: string) {
      const upload = websiteUploadMetadataSchema.parse(input);
      return repository.createUpload(orgId, { ...upload, uploadedBy });
    },

    async listPublicProducts(orgId: string) {
      return projectPublicProducts(await repository.listPublicProducts(orgId));
    },
  };
}
