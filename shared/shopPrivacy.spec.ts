import { describe, expect, it } from "vitest";
import {
  EMPTY_SHOP_PRIVACY,
  hasComplaintsContact,
  hasPrivacyNotice,
  privacyNoticeHref,
  receiptPrivacyLines,
  shopPrivacyFromOrg,
  shopPrivacyPatchSchema,
} from "./shopPrivacy";

const PAGE = "https://till.example/arcarna/privacy?orgId=o1";

describe("shop privacy notice (PRV-15)", () => {
  it("is empty by default and shows nothing", () => {
    const info = shopPrivacyFromOrg({});
    expect(info).toEqual(EMPTY_SHOP_PRIVACY);
    expect(hasPrivacyNotice(info)).toBe(false);
    expect(hasComplaintsContact(info)).toBe(false);
    expect(privacyNoticeHref(info, PAGE)).toBeNull();
    expect(receiptPrivacyLines(info, PAGE)).toEqual([]);
  });

  it("links to the owner's own page first, else to arcarna's page for the text", () => {
    expect(privacyNoticeHref({ ...EMPTY_SHOP_PRIVACY, privacyNoticeUrl: "https://shop.example/p" }, PAGE)).toBe(
      "https://shop.example/p",
    );
    expect(privacyNoticeHref({ ...EMPTY_SHOP_PRIVACY, privacyNoticeText: "We…" }, PAGE)).toBe(PAGE);
  });

  it("a complaints contact needs an email, not just a name", () => {
    expect(hasComplaintsContact({ ...EMPTY_SHOP_PRIVACY, complaintsContactName: "Sam" })).toBe(false);
    const lines = receiptPrivacyLines(
      { ...EMPTY_SHOP_PRIVACY, complaintsContactName: "Sam", complaintsContactEmail: "dpo@shop.example" },
      PAGE,
    );
    expect(lines).toEqual(["Data protection questions or complaints: Sam, dpo@shop.example"]);
  });

  it("only accepts web links and real emails", () => {
    expect(shopPrivacyPatchSchema.safeParse({ privacyNoticeUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(shopPrivacyPatchSchema.safeParse({ privacyNoticeUrl: "https://x.example/p" }).success).toBe(true);
    expect(shopPrivacyPatchSchema.safeParse({ privacyNoticeUrl: "" }).success).toBe(true);
    expect(shopPrivacyPatchSchema.safeParse({ complaintsContactEmail: "nope" }).success).toBe(false);
  });
});
