import { z } from "zod";
import {
  ORDER_STATUSES,
  WEBSITE_BLOCK_TYPES,
  WEBSITE_FILE_PROVIDERS,
  WEBSITE_ORDER_ACCESS_MODES,
} from "./schema";

export const WEBSITE_ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const WEBSITE_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const websiteHexColorSchema = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Use a hex colour like #FACC15");

export function isSafeWebsiteLink(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return true;

  try {
    const parsed = new URL(trimmed);
    return ["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

export const websiteSafeLinkSchema = z
  .string()
  .trim()
  .max(2048)
  .refine(isSafeWebsiteLink, "Use a relative, http, https, mailto, or tel link");

export const websiteThemePatchSchema = z
  .object({
    siteName: z.string().trim().min(1).max(255).optional(),
    logoFileId: z.string().uuid().nullable().optional(),
    faviconFileId: z.string().uuid().nullable().optional(),
    primaryColor: websiteHexColorSchema.optional(),
    secondaryColor: websiteHexColorSchema.optional(),
    accentColor: websiteHexColorSchema.optional(),
    backgroundColor: websiteHexColorSchema.optional(),
    textColor: websiteHexColorSchema.optional(),
    borderColor: websiteHexColorSchema.optional(),
    buttonBackgroundColor: websiteHexColorSchema.optional(),
    buttonTextColor: websiteHexColorSchema.optional(),
    headingFont: z.string().trim().max(120).nullable().optional(),
    bodyFont: z.string().trim().max(120).nullable().optional(),
    customCss: z.string().max(20_000).nullable().optional(),
  })
  .strict();

export const websiteUploadMetadataSchema = z
  .object({
    provider: z.enum(WEBSITE_FILE_PROVIDERS).default("local"),
    storageKey: z.string().trim().max(1024).nullable().optional(),
    publicUrl: websiteSafeLinkSchema,
    fileName: z.string().trim().min(1).max(255),
    originalFileName: z.string().trim().max(255).nullable().optional(),
    mimeType: z.enum(WEBSITE_ALLOWED_IMAGE_MIME_TYPES),
    byteSize: z.number().int().positive().max(WEBSITE_MAX_IMAGE_BYTES),
    width: z.number().int().positive().nullable().optional(),
    height: z.number().int().positive().nullable().optional(),
    altText: z.string().trim().max(255).nullable().optional(),
  })
  .strict();

export const websiteBlockInputSchema = z
  .object({
    page: z.string().trim().min(1).max(64).default("home"),
    type: z.enum(WEBSITE_BLOCK_TYPES),
    sortOrder: z.number().int().min(0).max(100_000).default(0),
    isVisible: z.boolean().default(true),
    title: z.string().trim().max(255).nullable().optional(),
    subtitle: z.string().trim().max(255).nullable().optional(),
    body: z.string().max(10_000).nullable().optional(),
    ctaLabel: z.string().trim().max(120).nullable().optional(),
    ctaLink: websiteSafeLinkSchema.nullable().optional(),
    imageFileId: z.string().uuid().nullable().optional(),
    backgroundColor: websiteHexColorSchema.nullable().optional(),
    textColor: websiteHexColorSchema.nullable().optional(),
    borderColor: websiteHexColorSchema.nullable().optional(),
    buttonBackgroundColor: websiteHexColorSchema.nullable().optional(),
    buttonTextColor: websiteHexColorSchema.nullable().optional(),
    overlayColor: websiteHexColorSchema.nullable().optional(),
    overlayOpacity: z.number().min(0).max(1).default(0),
    imageFit: z.enum(["cover", "contain", "fill"]).default("cover"),
    content: z.record(z.unknown()).default({}),
  })
  .strict();

export const websiteBlockPatchSchema = z
  .object({
    page: z.string().trim().min(1).max(64).optional(),
    type: z.enum(WEBSITE_BLOCK_TYPES).optional(),
    sortOrder: z.number().int().min(0).max(100_000).optional(),
    isVisible: z.boolean().optional(),
    title: z.string().trim().max(255).nullable().optional(),
    subtitle: z.string().trim().max(255).nullable().optional(),
    body: z.string().max(10_000).nullable().optional(),
    ctaLabel: z.string().trim().max(120).nullable().optional(),
    ctaLink: websiteSafeLinkSchema.nullable().optional(),
    imageFileId: z.string().uuid().nullable().optional(),
    backgroundColor: websiteHexColorSchema.nullable().optional(),
    textColor: websiteHexColorSchema.nullable().optional(),
    borderColor: websiteHexColorSchema.nullable().optional(),
    buttonBackgroundColor: websiteHexColorSchema.nullable().optional(),
    buttonTextColor: websiteHexColorSchema.nullable().optional(),
    overlayColor: websiteHexColorSchema.nullable().optional(),
    overlayOpacity: z.number().min(0).max(1).optional(),
    imageFit: z.enum(["cover", "contain", "fill"]).optional(),
    content: z.record(z.unknown()).optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "Provide at least one website block field",
  });

export const websiteOrderSettingsPatchSchema = z
  .object({
    orderAccessMode: z.enum(WEBSITE_ORDER_ACCESS_MODES).optional(),
    defaultOrderStatus: z.enum(ORDER_STATUSES).optional(),
    defaultLocationId: z.string().uuid().nullable().optional(),
    allowOutOfStockOrders: z.boolean().optional(),
    minOrderValue: z.number().nonnegative().nullable().optional(),
    orderIntroText: z.string().max(10_000).nullable().optional(),
    successMessage: z.string().max(10_000).nullable().optional(),
    notificationEmail: z.string().email().nullable().optional(),
  })
  .strict();

export const publicWebsiteOrderSchema = z
  .object({
    customer: z
      .object({
        name: z.string().trim().min(1).max(255),
        phone: z.string().trim().max(40).optional(),
        email: z.string().email().optional(),
      })
      .strict(),
    fulfilment: z
      .object({
        method: z.enum(["pickup", "delivery"]).default("pickup"),
        address: z.string().trim().max(1024).optional(),
        notes: z.string().trim().max(2000).optional(),
      })
      .strict()
      .default({ method: "pickup" }),
    items: z
      .array(
        z
          .object({
            productId: z.string().uuid(),
            quantity: z.number().int().positive().max(999),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    accessPassword: z.string().max(255).optional(),
  })
  .strict();

export type WebsiteThemePatch = z.infer<typeof websiteThemePatchSchema>;
export type WebsiteUploadMetadata = z.infer<typeof websiteUploadMetadataSchema>;
export type WebsiteBlockInput = z.infer<typeof websiteBlockInputSchema>;
export type WebsiteBlockPatch = z.infer<typeof websiteBlockPatchSchema>;
export type WebsiteOrderSettingsPatch = z.infer<typeof websiteOrderSettingsPatchSchema>;
export type PublicWebsiteOrderInput = z.infer<typeof publicWebsiteOrderSchema>;
