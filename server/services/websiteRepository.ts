import { and, eq } from "drizzle-orm";
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
} from "./website";
import type {
  WebsiteBlockInput,
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
        patch.minOrderValue === null || patch.minOrderValue === undefined
          ? patch.minOrderValue
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
};
