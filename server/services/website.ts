import {
  publicWebsiteOrderSchema,
  websiteBlockInputSchema,
  websiteBlockPatchSchema,
  websiteOrderSettingsPatchSchema,
  websiteThemePatchSchema,
  websiteUploadMetadataSchema,
  type PublicWebsiteOrderInput,
  type WebsiteBlockInput,
  type WebsiteBlockPatch,
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

export interface WebsiteUploadRow {
  id: string;
  provider: string;
  storageKey?: string | null;
  publicUrl: string;
  fileName: string;
  originalFileName?: string | null;
  mimeType: string;
  byteSize: number;
  width?: number | null;
  height?: number | null;
  altText?: string | null;
  status: string;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
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

export interface WebsiteOrderEngine {
  createCustomer(input: unknown): Promise<{ id: string }>;
  placeOrder(input: unknown): Promise<{ orderId: string; warnings?: string[] }>;
}

export interface WebsiteOrderRuntime {
  withTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
  engine: WebsiteOrderEngine;
  publishOrderCreated(
    tx: unknown,
    eventType: "OrderCreated",
    correlationId: string,
    payload: unknown,
    options: { source: string },
  ): Promise<string>;
  loadCreatedOrder(tx: unknown, orderId: string): Promise<{
    id: string;
    status: string | null;
    total: string | number | null;
    paymentMethod: string | null;
    customerId: string | null;
    items: Array<{
      id: string;
      productId: string | null;
      quantity: number;
      unitPrice: string | number | null;
      totalPrice: string | number | null;
    }>;
  } | null>;
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
  updateBlock(
    orgId: string,
    blockId: string,
    patch: WebsiteBlockPatch & { updatedBy?: string },
  ): Promise<WebsiteBlockRow | null>;
  duplicateBlock(
    orgId: string,
    blockId: string,
    updatedBy?: string,
  ): Promise<WebsiteBlockRow | null>;
  deleteBlock(orgId: string, blockId: string): Promise<boolean>;
  createUpload(
    orgId: string,
    upload: WebsiteUploadMetadata & { uploadedBy?: string },
  ): Promise<{ id: string; publicUrl: string }>;
  listUploads(orgId: string): Promise<WebsiteUploadRow[]>;
  listPublicProducts(orgId: string): Promise<WebsiteProductRow[]>;
  listWebsiteOrderProducts(orgId: string, productIds: string[]): Promise<WebsiteProductRow[]>;
}

export const DEFAULT_WEBSITE_THEME = {
  siteName: "WM Supplies",
  logoFileId: null,
  logoUrl: null,
  faviconFileId: null,
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

export class WebsitePublicOrderError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "WebsitePublicOrderError";
  }
}

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

function combinePublicOrderItems(orderLines: PublicWebsiteOrderInput["items"]) {
  const byProductId = new Map<string, number>();
  for (const orderLine of orderLines) {
    byProductId.set(
      orderLine.productId,
      (byProductId.get(orderLine.productId) ?? 0) + orderLine.quantity,
    );
  }
  return [...byProductId.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

function calculateResolvedSubtotal(
  lines: Array<{ quantity: number; unitPrice: number }>,
): number {
  return Number(
    lines.reduce((total, line) => total + line.quantity * line.unitPrice, 0).toFixed(2),
  );
}

export function resolvePublicOrderLines(params: {
  requestedItems: PublicWebsiteOrderInput["items"];
  products: WebsiteProductRow[];
  settings: ReturnType<typeof normalizeWebsiteOrderSettings>;
}) {
  const combinedItems = combinePublicOrderItems(params.requestedItems);
  const productById = new Map(params.products.map((product) => [product.id, product]));
  const missing = combinedItems.filter((orderLine) => !productById.has(orderLine.productId));
  if (missing.length > 0) {
    throw new WebsitePublicOrderError(400, "One or more products are not available online", {
      productIds: missing.map((orderLine) => orderLine.productId),
    });
  }

  const stockShortages = combinedItems
    .map((orderLine) => {
      const product = productById.get(orderLine.productId);
      if (!product || product.stock === null || product.stock === undefined) return null;
      return product.stock < orderLine.quantity
        ? {
            productId: orderLine.productId,
            available: product.stock,
            requested: orderLine.quantity,
          }
        : null;
    })
    .filter((shortage): shortage is NonNullable<typeof shortage> => Boolean(shortage));

  if (stockShortages.length > 0) {
    throw new WebsitePublicOrderError(
      409,
      params.settings.allowOutOfStockOrders
        ? "Out-of-stock website orders are not enabled for this release"
        : "One or more products do not have enough stock",
      { stockShortages },
    );
  }

  const lines = combinedItems.map((orderLine) => {
    const product = productById.get(orderLine.productId);
    return {
      productId: orderLine.productId,
      quantity: orderLine.quantity,
      unitPrice: asNumber(product?.defaultSalePrice, 0),
    };
  });
  const subtotal = calculateResolvedSubtotal(lines);

  if (params.settings.minOrderValue !== null && subtotal < params.settings.minOrderValue) {
    throw new WebsitePublicOrderError(
      400,
      `Minimum order value is ${params.settings.minOrderValue.toFixed(2)}`,
      { minOrderValue: params.settings.minOrderValue, subtotal },
    );
  }

  return { lines, subtotal };
}

function assertPublicOrderAccess(
  settings: ReturnType<typeof normalizeWebsiteOrderSettings>,
  order: PublicWebsiteOrderInput,
) {
  if (settings.orderAccessMode === "clerk") {
    throw new WebsitePublicOrderError(401, "Sign in is required to place a website order");
  }
  if (settings.orderAccessMode !== "password") return;

  const expected = process.env.WM_SUPPLIES_ORDER_PASSWORD?.trim();
  if (!expected) {
    throw new WebsitePublicOrderError(503, "Website order password is not configured");
  }
  if (order.accessPassword !== expected) {
    throw new WebsitePublicOrderError(403, "Incorrect website order password");
  }
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

    validateBlockPatch(input: unknown) {
      return websiteBlockPatchSchema.parse(input);
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

    async updateBlock(orgId: string, blockId: string, input: unknown, updatedBy?: string) {
      const patch = websiteBlockPatchSchema.parse(input);
      return repository.updateBlock(orgId, blockId, { ...patch, updatedBy });
    },

    async duplicateBlock(orgId: string, blockId: string, updatedBy?: string) {
      return repository.duplicateBlock(orgId, blockId, updatedBy);
    },

    async deleteBlock(orgId: string, blockId: string) {
      return repository.deleteBlock(orgId, blockId);
    },

    async createUpload(orgId: string, input: unknown, uploadedBy?: string) {
      const upload = websiteUploadMetadataSchema.parse(input);
      return repository.createUpload(orgId, { ...upload, uploadedBy });
    },

    async listUploads(orgId: string) {
      return repository.listUploads(orgId);
    },

    async listPublicProducts(orgId: string) {
      return projectPublicProducts(await repository.listPublicProducts(orgId));
    },

    async submitPublicOrder(orgId: string, input: unknown, runtime: WebsiteOrderRuntime) {
      const order = publicWebsiteOrderSchema.parse(input);
      const settings = normalizeWebsiteOrderSettings(await repository.getOrderSettings(orgId));
      assertPublicOrderAccess(settings, order);

      const requestedProductIds = [...new Set(order.items.map((orderLine) => orderLine.productId))];
      const products = await repository.listWebsiteOrderProducts(orgId, requestedProductIds);
      const resolved = resolvePublicOrderLines({
        requestedItems: order.items,
        products,
        settings,
      });

      return runtime.withTransaction(async (tx) => {
        const customer = await runtime.engine.createCustomer({
          orgId,
          name: order.customer.name,
          phone: order.customer.phone,
          email: order.customer.email,
          address: order.fulfilment.method === "delivery" ? order.fulfilment.address : undefined,
          source: "website",
        });
        const result = await runtime.engine.placeOrder({
          orgId,
          customerId: customer.id,
          locationId: settings.defaultLocationId ?? undefined,
          lines: resolved.lines,
          paymentMethod: "transfer",
          channel: "web",
          status: settings.defaultOrderStatus,
        });
        const createdOrder = await runtime.loadCreatedOrder(tx, result.orderId);
        const orderTotal = asNumber(createdOrder?.total, resolved.subtotal);
        const eventId = await runtime.publishOrderCreated(
          tx,
          "OrderCreated",
          result.orderId,
          {
            order: {
              orderId: result.orderId,
              status: createdOrder?.status || settings.defaultOrderStatus,
              customerId: createdOrder?.customerId ?? customer.id,
              total: orderTotal,
              paymentMethod: createdOrder?.paymentMethod ?? "transfer",
              channel: "web",
              source: "website",
              fulfilment: order.fulfilment,
              items:
                createdOrder?.items.map((orderLine) => ({
                  lineId: orderLine.id,
                  productId: orderLine.productId,
                  qty: orderLine.quantity,
                  unitPrice: asNumber(orderLine.unitPrice),
                  lineTotal: asNumber(orderLine.totalPrice),
                })) ??
                resolved.lines.map((line) => ({
                  productId: line.productId,
                  qty: line.quantity,
                  unitPrice: line.unitPrice,
                  lineTotal: Number((line.quantity * line.unitPrice).toFixed(2)),
                })),
            },
          },
          { source: "wm-supplies-website" },
        );

        return {
          orderId: result.orderId,
          eventId,
          status: createdOrder?.status || settings.defaultOrderStatus,
          subtotal: resolved.subtotal,
          total: orderTotal,
          warnings: result.warnings ?? [],
        };
      });
    },
  };
}
