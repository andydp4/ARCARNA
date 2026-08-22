import type {
  PublicSiteConfig,
  PublicWebsiteBlock,
  PublicWebsiteOrderSettings,
  PublicWebsiteTheme,
  WebsiteBlockType,
} from "./publicWebsite";

export const WEBSITE_BLOCK_TYPE_OPTIONS: WebsiteBlockType[] = [
  "hero",
  "image",
  "wide",
  "split",
  "cta",
  "notice",
  "gallery",
  "spacer",
];

export const WEBSITE_ORDER_ACCESS_MODE_OPTIONS = ["public", "password", "clerk"] as const;

export const WEBSITE_ORDER_STATUS_OPTIONS = [
  "pending",
  "on-hold",
  "awaiting-customer",
  "urgent",
  "completed",
] as const;

export type WebsiteUploadItem = {
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
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type WebsiteBlockDraft = {
  page: string;
  type: WebsiteBlockType;
  sortOrder: string;
  isVisible: boolean;
  title: string;
  subtitle: string;
  body: string;
  ctaLabel: string;
  ctaLink: string;
  imageFileId: string;
  backgroundColor: string;
  textColor: string;
  borderColor: string;
  buttonBackgroundColor: string;
  buttonTextColor: string;
  overlayColor: string;
  overlayOpacity: string;
  imageFit: "cover" | "contain" | "fill";
  contentText: string;
};

export type WebsiteOrderSettingsDraft = Omit<PublicWebsiteOrderSettings, "minOrderValue"> & {
  minOrderValue: string;
};

export type WebsiteMediaDraft = {
  provider: "local" | "r2";
  publicUrl: string;
  fileName: string;
  originalFileName: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  byteSize: string;
  width: string;
  height: string;
  altText: string;
};

type WebsiteBlockPayload = {
  page: string;
  type: WebsiteBlockType;
  sortOrder: number;
  isVisible: boolean;
  title: string | null;
  subtitle: string | null;
  body: string | null;
  ctaLabel: string | null;
  ctaLink: string | null;
  imageFileId: string | null;
  backgroundColor: string | null;
  textColor: string | null;
  borderColor: string | null;
  buttonBackgroundColor: string | null;
  buttonTextColor: string | null;
  overlayColor: string | null;
  overlayOpacity: number;
  imageFit: "cover" | "contain" | "fill";
  content: Record<string, unknown>;
};

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function nullableColor(value: string): string | null {
  return nullableText(value);
}

function parseIntField(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFloatField(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function defaultWebsiteBlockDraft(nextSortOrder = 0): WebsiteBlockDraft {
  return {
    page: "home",
    type: "hero",
    sortOrder: String(nextSortOrder),
    isVisible: true,
    title: "",
    subtitle: "",
    body: "",
    ctaLabel: "",
    ctaLink: "",
    imageFileId: "",
    backgroundColor: "",
    textColor: "",
    borderColor: "",
    buttonBackgroundColor: "",
    buttonTextColor: "",
    overlayColor: "",
    overlayOpacity: "0",
    imageFit: "cover",
    contentText: "{}",
  };
}

export function blockToDraft(block: PublicWebsiteBlock): WebsiteBlockDraft {
  return {
    page: block.page,
    type: block.type,
    sortOrder: String(block.sortOrder),
    isVisible: block.isVisible,
    title: block.title ?? "",
    subtitle: block.subtitle ?? "",
    body: block.body ?? "",
    ctaLabel: block.ctaLabel ?? "",
    ctaLink: block.ctaLink ?? "",
    imageFileId: block.image?.id ?? "",
    backgroundColor: block.colors.backgroundColor ?? "",
    textColor: block.colors.textColor ?? "",
    borderColor: block.colors.borderColor ?? "",
    buttonBackgroundColor: block.colors.buttonBackgroundColor ?? "",
    buttonTextColor: block.colors.buttonTextColor ?? "",
    overlayColor: block.colors.overlayColor ?? "",
    overlayOpacity: String(block.colors.overlayOpacity ?? 0),
    imageFit: block.imageFit,
    contentText: JSON.stringify(block.content ?? {}, null, 2),
  };
}

export function blockDraftToPayload(draft: WebsiteBlockDraft): WebsiteBlockPayload {
  const content = draft.contentText.trim() ? JSON.parse(draft.contentText) : {};
  if (typeof content !== "object" || content === null || Array.isArray(content)) {
    throw new Error("Block content must be a JSON object");
  }

  return {
    page: draft.page.trim() || "home",
    type: draft.type,
    sortOrder: parseIntField(draft.sortOrder, 0),
    isVisible: draft.isVisible,
    title: nullableText(draft.title),
    subtitle: nullableText(draft.subtitle),
    body: nullableText(draft.body),
    ctaLabel: nullableText(draft.ctaLabel),
    ctaLink: nullableText(draft.ctaLink),
    imageFileId: nullableText(draft.imageFileId),
    backgroundColor: nullableColor(draft.backgroundColor),
    textColor: nullableColor(draft.textColor),
    borderColor: nullableColor(draft.borderColor),
    buttonBackgroundColor: nullableColor(draft.buttonBackgroundColor),
    buttonTextColor: nullableColor(draft.buttonTextColor),
    overlayColor: nullableColor(draft.overlayColor),
    overlayOpacity: Math.min(1, Math.max(0, parseFloatField(draft.overlayOpacity, 0))),
    imageFit: draft.imageFit,
    content: content as Record<string, unknown>,
  };
}

export function orderSettingsToDraft(
  settings: PublicWebsiteOrderSettings,
): WebsiteOrderSettingsDraft {
  return {
    ...settings,
    minOrderValue: settings.minOrderValue === null ? "" : String(settings.minOrderValue),
  };
}

export function orderSettingsDraftToPayload(draft: WebsiteOrderSettingsDraft) {
  return {
    ...draft,
    minOrderValue:
      draft.minOrderValue.trim() === "" ? null : parseFloatField(draft.minOrderValue, 0),
    defaultLocationId: nullableText(draft.defaultLocationId ?? ""),
    orderIntroText: nullableText(draft.orderIntroText ?? ""),
    successMessage: nullableText(draft.successMessage ?? ""),
    notificationEmail: nullableText(draft.notificationEmail ?? ""),
  };
}

export function themeDraftToPayload(theme: PublicWebsiteTheme) {
  return {
    siteName: theme.siteName,
    primaryColor: theme.primaryColor,
    secondaryColor: theme.secondaryColor,
    accentColor: theme.accentColor,
    backgroundColor: theme.backgroundColor,
    textColor: theme.textColor,
    borderColor: theme.borderColor,
    buttonBackgroundColor: theme.buttonBackgroundColor,
    buttonTextColor: theme.buttonTextColor,
    headingFont: theme.headingFont ?? null,
    bodyFont: theme.bodyFont ?? null,
    customCss: theme.customCss ?? null,
  };
}

export function defaultWebsiteMediaDraft(): WebsiteMediaDraft {
  return {
    provider: "local",
    publicUrl: "",
    fileName: "",
    originalFileName: "",
    mimeType: "image/webp",
    byteSize: "1024",
    width: "",
    height: "",
    altText: "",
  };
}

export function deriveFileNameFromUrl(publicUrl: string): string {
  const cleanPath = publicUrl.split("?")[0].split("#")[0];
  const fileName = cleanPath.split("/").filter(Boolean).pop();
  return fileName || "";
}

export function mediaDraftToPayload(draft: WebsiteMediaDraft) {
  return {
    provider: draft.provider,
    publicUrl: draft.publicUrl.trim(),
    fileName: nullableText(draft.fileName) ?? deriveFileNameFromUrl(draft.publicUrl),
    originalFileName: nullableText(draft.originalFileName),
    mimeType: draft.mimeType,
    byteSize: parseIntField(draft.byteSize, 0),
    width: draft.width.trim() === "" ? null : parseIntField(draft.width, 0),
    height: draft.height.trim() === "" ? null : parseIntField(draft.height, 0),
    altText: nullableText(draft.altText),
  };
}

export function nextBlockSortOrder(config: PublicSiteConfig | undefined): number {
  const maxSort = Math.max(-10, ...(config?.blocks.map((block) => block.sortOrder) ?? []));
  return maxSort + 10;
}
