import { describe, expect, it } from "vitest";
import {
  blockDraftToPayload,
  blockToDraft,
  defaultWebsiteBlockDraft,
  deriveFileNameFromUrl,
  mediaDraftToPayload,
  nextBlockSortOrder,
  orderSettingsDraftToPayload,
  orderSettingsToDraft,
  themeDraftToPayload,
} from "../adminWebsite";
import { buildFallbackBlocks, fallbackSiteConfig } from "../publicWebsite";

const fallbackBlock = buildFallbackBlocks(fallbackSiteConfig.theme)[0];

describe("WM Supplies admin website helpers", () => {
  it("turns block form blanks into nulls and clamps overlay opacity", () => {
    const payload = blockDraftToPayload({
      ...defaultWebsiteBlockDraft(40),
      title: "  Hero ",
      ctaLink: " ",
      overlayOpacity: "1.5",
      contentText: '{ "strapline": "Trade counter" }',
    });

    expect(payload).toMatchObject({
      page: "home",
      title: "Hero",
      ctaLink: null,
      sortOrder: 40,
      overlayOpacity: 1,
      content: { strapline: "Trade counter" },
    });
  });

  it("rejects non-object block content JSON", () => {
    expect(() =>
      blockDraftToPayload({
        ...defaultWebsiteBlockDraft(),
        contentText: "[1, 2, 3]",
      }),
    ).toThrow(/json object/i);
  });

  it("round-trips an existing block into an editable draft", () => {
    const block = {
      ...fallbackBlock,
      id: "block-1",
      imageFit: "contain" as const,
      content: { columns: 2 },
    };
    const draft = blockToDraft(block);

    expect(draft.imageFit).toBe("contain");
    expect(JSON.parse(draft.contentText)).toEqual({ columns: 2 });
  });

  it("normalizes order, theme, and media form payloads", () => {
    const orderDraft = orderSettingsToDraft({
      ...fallbackSiteConfig.orderSettings,
      minOrderValue: 25,
      notificationEmail: null,
    });

    expect(orderSettingsDraftToPayload(orderDraft)).toMatchObject({
      minOrderValue: 25,
      notificationEmail: null,
    });
    expect(themeDraftToPayload(fallbackSiteConfig.theme)).toMatchObject({
      siteName: "WM Supplies",
      primaryColor: "#ff2bd6",
    });
    expect(
      mediaDraftToPayload({
        provider: "local",
        publicUrl: "/uploads/website/hero.webp?version=1",
        fileName: "",
        originalFileName: "",
        mimeType: "image/webp",
        byteSize: "2048",
        width: "",
        height: "",
        altText: "Hero shelf",
      }),
    ).toMatchObject({
      fileName: "hero.webp",
      byteSize: 2048,
      width: null,
      altText: "Hero shelf",
    });
  });

  it("derives the next block sort order from the current config", () => {
    expect(deriveFileNameFromUrl("https://cdn.example.com/path/image.png#hash")).toBe(
      "image.png",
    );
    expect(
      nextBlockSortOrder({
        ...fallbackSiteConfig,
        blocks: [
          { ...fallbackBlock, id: "a", sortOrder: 10 },
          { ...fallbackBlock, id: "b", sortOrder: 30 },
        ],
      }),
    ).toBe(40);
  });
});
