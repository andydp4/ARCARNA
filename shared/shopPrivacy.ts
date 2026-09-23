/**
 * The shop's own customer privacy notice and data protection complaints
 * contact (PRV-15). The shop is the controller for its customers' data, so it
 * owes them a notice (UK GDPR Art. 13) and, since 19 June 2026, a route for
 * data protection complaints (DUAA). The owner writes the wording: these
 * fields ship empty, and every link to them stays hidden until they are filled.
 */
import { z } from "zod";

export interface ShopPrivacyInfo {
  privacyNoticeUrl: string;
  privacyNoticeText: string;
  complaintsContactName: string;
  complaintsContactEmail: string;
}

export const EMPTY_SHOP_PRIVACY: ShopPrivacyInfo = {
  privacyNoticeUrl: "",
  privacyNoticeText: "",
  complaintsContactName: "",
  complaintsContactEmail: "",
};

/** http(s) only: this URL is rendered as a link on the shop site and in receipts. */
const httpUrl = z
  .string()
  .trim()
  .max(1024)
  .url("Enter a full web address, starting https://")
  .refine((u) => /^https?:\/\//i.test(u), "Enter a full web address, starting https://");

export const shopPrivacyPatchSchema = z.object({
  privacyNoticeUrl: z.union([z.literal(""), httpUrl]).optional(),
  privacyNoticeText: z.string().trim().max(20_000).optional(),
  complaintsContactName: z.string().trim().max(255).optional(),
  complaintsContactEmail: z.union([z.literal(""), z.string().trim().max(255).email()]).optional(),
});

export type ShopPrivacyPatch = z.infer<typeof shopPrivacyPatchSchema>;

type OrgPrivacyColumns = {
  privacyNoticeUrl?: string | null;
  privacyNoticeText?: string | null;
  complaintsContactName?: string | null;
  complaintsContactEmail?: string | null;
};

export function shopPrivacyFromOrg(org: OrgPrivacyColumns | null | undefined): ShopPrivacyInfo {
  return {
    privacyNoticeUrl: org?.privacyNoticeUrl?.trim() || "",
    privacyNoticeText: org?.privacyNoticeText?.trim() || "",
    complaintsContactName: org?.complaintsContactName?.trim() || "",
    complaintsContactEmail: org?.complaintsContactEmail?.trim() || "",
  };
}

export function hasPrivacyNotice(info: ShopPrivacyInfo): boolean {
  return !!(info.privacyNoticeUrl || info.privacyNoticeText);
}

/** A complaints contact needs somewhere to write to; a name alone is not one. */
export function hasComplaintsContact(info: ShopPrivacyInfo): boolean {
  return !!info.complaintsContactEmail;
}

/**
 * Where "Privacy notice" should point: the owner's own page if they gave one,
 * otherwise arcarna's /privacy page showing the text they wrote, otherwise
 * nowhere (the link is hidden).
 */
export function privacyNoticeHref(info: ShopPrivacyInfo, textPageUrl: string): string | null {
  if (info.privacyNoticeUrl) return info.privacyNoticeUrl;
  if (info.privacyNoticeText) return textPageUrl;
  return null;
}

/** Plain-text lines for a printed/PDF receipt. Empty when nothing is filled in. */
export function receiptPrivacyLines(info: ShopPrivacyInfo, textPageUrl: string): string[] {
  const lines: string[] = [];
  const href = privacyNoticeHref(info, textPageUrl);
  if (href) lines.push(`How we use your information: ${href}`);
  if (hasComplaintsContact(info)) {
    const who = info.complaintsContactName ? `${info.complaintsContactName}, ` : "";
    lines.push(`Data protection questions or complaints: ${who}${info.complaintsContactEmail}`);
  }
  return lines;
}
