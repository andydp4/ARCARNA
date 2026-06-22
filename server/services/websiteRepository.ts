import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  organizations,
  products,
  websiteBlocks,
  websiteOrderSettings,
  websiteThemeSettings,
  websiteUploadedFiles,
} from "@shared/schema";
import type {
  WebsiteRepository,
  WebsiteThemeRow,
  WebsiteOrderSettingsRow,
  WebsiteBlockRow,
  WebsiteProductRow,
  WebsiteUploadRow,
} from "./website";
import type {
  WebsiteBlockInput,
  WebsiteBlockPatch,
  WebsiteOrderSettingsPatch,
  WebsiteThemePatch,
  WebsiteUploadMetadata,
} from "@shared/website";

function withoutUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

export const websiteRepository: WebsiteRepository = {
  async getOrg(orgId) {
    const [org] = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        tradingName: organizations.tradingName,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    return org ?? null;
  },

  async getThemeSettings(orgId): Promise<WebsiteThemeRow | null> {
    const [row] = await db
      .select()
      .from(websiteThemeSettings)
      .where(eq(websiteThemeSettings.orgId, orgId))
      .limit(1);

    if (!row) return null;
    return {
      ...row,
      logoUrl: null,
      faviconUrl: null,
    };
  },

  async upsertThemeSettings(
    orgId: string,
    patch: WebsiteThemePatch & { updatedBy?: string },
  ): Promise<WebsiteThemeRow> {
    const values = withoutUndefined({
      orgId,
      siteName: patch.siteName,
      logoFileId: patch.logoFileId,
      faviconFileId: patch.faviconFileId,
      primaryColor: patch.primaryColor,
      secondaryColor: patch.secondaryColor,
      accentColor: patch.accentColor,
      backgroundColor: patch.backgroundColor,
      textColor: patch.textColor,
      borderColor: patch.borderColor,
      buttonBackgroundColor: patch.buttonBackgroundColor,
      buttonTextColor: patch.buttonTextColor,
      headingFont: patch.headingFont,
      bodyFont: patch.bodyFont,
      customCss: patch.customCss,
      updatedBy: patch.updatedBy,
      updatedAt: new Date(),
    });

    const [row] = await db
      .insert(websiteThemeSettings)
      .values(values as typeof websiteThemeSettings.$inferInsert)
      .onConflictDoUpdate({
        target: websiteThemeSettings.orgId,
        set: values,
      })
      .returning();

    return { ...row, logoUrl: null, faviconUrl: null };
  },

  async getOrderSettings(orgId): Promise<WebsiteOrderSettingsRow | null> {
    const [row] = await db
      .select()
      .from(websiteOrderSettings)
      .where(eq(websiteOrderSettings.orgId, orgId))
      .limit(1);

    return row ?? null;
  },

  async upsertOrderSettings(
    orgId: string,
    patch: WebsiteOrderSettingsPatch & { updatedBy?: string },
  ): Promise<WebsiteOrderSettingsRow> {
    const values = withoutUndefined({
      orgId,
      orderAccessMode: patch.orderAccessMode,
      defaultOrderStatus: patch.defaultOrderStatus,
      defaultLocationId: patch.defaultLocationId,
      allowOutOfStockOrders: patch.allowOutOfStockOrders,
      minOrderValue:
        patch.minOrderValue === undefined
          ? undefined
          : patch.minOrderValue === null
            ? null
            : String(patch.minOrderValue),
      orderIntroText: patch.orderIntroText,
      successMessage: patch.successMessage,
      notificationEmail: patch.notificationEmail,
      updatedBy: patch.updatedBy,
      updatedAt: new Date(),
    });

    const [row] = await db
      .insert(websiteOrderSettings)
      .values(values as typeof websiteOrderSettings.$inferInsert)
      .onConflictDoUpdate({
        target: websiteOrderSettings.orgId,
        set: values,
      })
      .returning();

    return row;
  },

  async listBlocks(orgId: string, page: string): Promise<WebsiteBlockRow[]> {
    const rows = await db
      .select({
        id: websiteBlocks.id,
        page: websiteBlocks.page,
        type: websiteBlocks.type,
        sortOrder: websiteBlocks.sortOrder,
        isVisible: websiteBlocks.isVisible,
        title: websiteBlocks.title,
        subtitle: websiteBlocks.subtitle,
        body: websiteBlocks.body,
        ctaLabel: websiteBlocks.ctaLabel,
        ctaLink: websiteBlocks.ctaLink,
        imageFileId: websiteBlocks.imageFileId,
        imageUrl: websiteUploadedFiles.publicUrl,
        imageAlt: websiteUploadedFiles.altText,
        backgroundColor: websiteBlocks.backgroundColor,
        textColor: websiteBlocks.textColor,
        borderColor: websiteBlocks.borderColor,
        buttonBackgroundColor: websiteBlocks.buttonBackgroundColor,
        buttonTextColor: websiteBlocks.buttonTextColor,
        overlayColor: websiteBlocks.overlayColor,
        overlayOpacity: websiteBlocks.overlayOpacity,
        imageFit: websiteBlocks.imageFit,
        content: websiteBlocks.content,
      })
      .from(websiteBlocks)
      .leftJoin(websiteUploadedFiles, eq(websiteBlocks.imageFileId, websiteUploadedFiles.id))
      .where(and(eq(websiteBlocks.orgId, orgId), eq(websiteBlocks.page, page)));

    return rows;
  },

  async upsertBlock(
    orgId: string,
    block: WebsiteBlockInput & { updatedBy?: string },
  ): Promise<WebsiteBlockRow> {
    const [row] = await db
      .insert(websiteBlocks)
      .values({
        orgId,
        page: block.page,
        type: block.type,
        sortOrder: block.sortOrder,
        isVisible: block.isVisible,
        title: block.title,
        subtitle: block.subtitle,
        body: block.body,
        ctaLabel: block.ctaLabel,
        ctaLink: block.ctaLink,
        imageFileId: block.imageFileId,
        backgroundColor: block.backgroundColor,
        textColor: block.textColor,
        borderColor: block.borderColor,
        buttonBackgroundColor: block.buttonBackgroundColor,
        buttonTextColor: block.buttonTextColor,
        overlayColor: block.overlayColor,
        overlayOpacity: String(block.overlayOpacity),
        imageFit: block.imageFit,
        content: block.content,
        createdBy: block.updatedBy,
        updatedBy: block.updatedBy,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return { ...row, imageUrl: null, imageAlt: null };
  },

  async updateBlock(
    orgId: string,
    blockId: string,
    patch: WebsiteBlockPatch & { updatedBy?: string },
  ): Promise<WebsiteBlockRow | null> {
    const values = withoutUndefined({
      page: patch.page,
      type: patch.type,
      sortOrder: patch.sortOrder,
      isVisible: patch.isVisible,
      title: patch.title,
      subtitle: patch.subtitle,
      body: patch.body,
      ctaLabel: patch.ctaLabel,
      ctaLink: patch.ctaLink,
      imageFileId: patch.imageFileId,
      backgroundColor: patch.backgroundColor,
      textColor: patch.textColor,
      borderColor: patch.borderColor,
      buttonBackgroundColor: patch.buttonBackgroundColor,
      buttonTextColor: patch.buttonTextColor,
      overlayColor: patch.overlayColor,
      overlayOpacity:
        patch.overlayOpacity === undefined ? undefined : String(patch.overlayOpacity),
      imageFit: patch.imageFit,
      content: patch.content,
      updatedBy: patch.updatedBy,
      updatedAt: new Date(),
    });

    const [row] = await db
      .update(websiteBlocks)
      .set(values)
      .where(and(eq(websiteBlocks.orgId, orgId), eq(websiteBlocks.id, blockId)))
      .returning();

    return row ? { ...row, imageUrl: null, imageAlt: null } : null;
  },

  async duplicateBlock(
    orgId: string,
    blockId: string,
    updatedBy?: string,
  ): Promise<WebsiteBlockRow | null> {
    const [source] = await db
      .select()
      .from(websiteBlocks)
      .where(and(eq(websiteBlocks.orgId, orgId), eq(websiteBlocks.id, blockId)))
      .limit(1);

    if (!source) return null;

    const [row] = await db
      .insert(websiteBlocks)
      .values({
        orgId,
        page: source.page,
        type: source.type,
        sortOrder: source.sortOrder + 1,
        isVisible: source.isVisible,
        title: source.title ? `${source.title} copy` : source.title,
        subtitle: source.subtitle,
        body: source.body,
        ctaLabel: source.ctaLabel,
        ctaLink: source.ctaLink,
        imageFileId: source.imageFileId,
        backgroundColor: source.backgroundColor,
        textColor: source.textColor,
        borderColor: source.borderColor,
        buttonBackgroundColor: source.buttonBackgroundColor,
        buttonTextColor: source.buttonTextColor,
        overlayColor: source.overlayColor,
        overlayOpacity: String(source.overlayOpacity ?? 0),
        imageFit: source.imageFit,
        content: source.content ?? {},
        createdBy: updatedBy ?? source.createdBy ?? undefined,
        updatedBy: updatedBy ?? source.updatedBy ?? undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return { ...row, imageUrl: null, imageAlt: null };
  },

  async deleteBlock(orgId: string, blockId: string): Promise<boolean> {
    const deleted = await db
      .delete(websiteBlocks)
      .where(and(eq(websiteBlocks.orgId, orgId), eq(websiteBlocks.id, blockId)))
      .returning({ id: websiteBlocks.id });

    return deleted.length > 0;
  },

  async createUpload(
    orgId: string,
    upload: WebsiteUploadMetadata & { uploadedBy?: string },
  ): Promise<{ id: string; publicUrl: string }> {
    const [row] = await db
      .insert(websiteUploadedFiles)
      .values({
        orgId,
        provider: upload.provider,
        storageKey: upload.storageKey,
        publicUrl: upload.publicUrl,
        fileName: upload.fileName,
        originalFileName: upload.originalFileName,
        mimeType: upload.mimeType,
        byteSize: upload.byteSize,
        width: upload.width,
        height: upload.height,
        altText: upload.altText,
        uploadedBy: upload.uploadedBy,
        status: "available",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: websiteUploadedFiles.id, publicUrl: websiteUploadedFiles.publicUrl });

    return row;
  },

  async listUploads(orgId: string): Promise<WebsiteUploadRow[]> {
    return db
      .select({
        id: websiteUploadedFiles.id,
        provider: websiteUploadedFiles.provider,
        storageKey: websiteUploadedFiles.storageKey,
        publicUrl: websiteUploadedFiles.publicUrl,
        fileName: websiteUploadedFiles.fileName,
        originalFileName: websiteUploadedFiles.originalFileName,
        mimeType: websiteUploadedFiles.mimeType,
        byteSize: websiteUploadedFiles.byteSize,
        width: websiteUploadedFiles.width,
        height: websiteUploadedFiles.height,
        altText: websiteUploadedFiles.altText,
        status: websiteUploadedFiles.status,
        createdAt: websiteUploadedFiles.createdAt,
        updatedAt: websiteUploadedFiles.updatedAt,
      })
      .from(websiteUploadedFiles)
      .where(and(eq(websiteUploadedFiles.orgId, orgId), eq(websiteUploadedFiles.status, "available")))
      .orderBy(desc(websiteUploadedFiles.createdAt));
  },

  async listPublicProducts(orgId: string): Promise<WebsiteProductRow[]> {
    const rows = await db
      .select({
        id: products.id,
        productId: products.productId,
        name: products.name,
        defaultSalePrice: products.defaultSalePrice,
        availableForWebsite: products.availableForWebsite,
        websiteTitle: products.websiteTitle,
        websiteDescription: products.websiteDescription,
        websiteCategory: products.websiteCategory,
        websiteUnitLabel: products.websiteUnitLabel,
        websiteSortOrder: products.websiteSortOrder,
        websiteImageFileId: products.websiteImageFileId,
        websiteImageUrl: websiteUploadedFiles.publicUrl,
        websiteImageAlt: websiteUploadedFiles.altText,
        stock: products.stock,
        costPrice: products.costPrice,
      })
      .from(products)
      .leftJoin(websiteUploadedFiles, eq(products.websiteImageFileId, websiteUploadedFiles.id))
      .where(and(eq(products.orgId, orgId), eq(products.availableForWebsite, true)));

    return rows;
  },

  async listWebsiteOrderProducts(
    orgId: string,
    productIds: string[],
  ): Promise<WebsiteProductRow[]> {
    if (productIds.length === 0) return [];

    const rows = await db
      .select({
        id: products.id,
        productId: products.productId,
        name: products.name,
        defaultSalePrice: products.defaultSalePrice,
        availableForWebsite: products.availableForWebsite,
        websiteTitle: products.websiteTitle,
        websiteDescription: products.websiteDescription,
        websiteCategory: products.websiteCategory,
        websiteUnitLabel: products.websiteUnitLabel,
        websiteSortOrder: products.websiteSortOrder,
        websiteImageFileId: products.websiteImageFileId,
        websiteImageUrl: websiteUploadedFiles.publicUrl,
        websiteImageAlt: websiteUploadedFiles.altText,
        stock: products.stock,
        costPrice: products.costPrice,
      })
      .from(products)
      .leftJoin(websiteUploadedFiles, eq(products.websiteImageFileId, websiteUploadedFiles.id))
      .where(
        and(
          eq(products.orgId, orgId),
          eq(products.availableForWebsite, true),
          inArray(products.id, productIds),
        ),
      );

    return rows;
  },
};
