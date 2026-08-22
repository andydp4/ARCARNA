import { describe, expect, it } from "vitest";
import { websiteProductSettingsPatchSchema } from "@shared/website";

describe("website product settings validation", () => {
  it("accepts website product visibility and display metadata", () => {
    expect(
      websiteProductSettingsPatchSchema.parse({
        availableForWebsite: true,
        websiteTitle: "Blue Roll",
        websiteDescription: "Two-ply blue centrefeed roll",
        websiteCategory: "Cleaning",
        websiteUnitLabel: "case",
        websiteSortOrder: 12,
        websiteImageFileId: "00000000-0000-4000-8000-000000000001",
      }),
    ).toEqual({
      availableForWebsite: true,
      websiteTitle: "Blue Roll",
      websiteDescription: "Two-ply blue centrefeed roll",
      websiteCategory: "Cleaning",
      websiteUnitLabel: "case",
      websiteSortOrder: 12,
      websiteImageFileId: "00000000-0000-4000-8000-000000000001",
    });
  });

  it("rejects empty, unknown, or unsafe website product patches", () => {
    expect(() => websiteProductSettingsPatchSchema.parse({})).toThrow(/website product field/i);
    expect(() =>
      websiteProductSettingsPatchSchema.parse({
        availableForWebsite: true,
        internalCostPrice: "1.00",
      }),
    ).toThrow();
    expect(() =>
      websiteProductSettingsPatchSchema.parse({
        websiteSortOrder: -1,
      }),
    ).toThrow();
    expect(() =>
      websiteProductSettingsPatchSchema.parse({
        websiteImageFileId: "not-a-uuid",
      }),
    ).toThrow();
  });
});
