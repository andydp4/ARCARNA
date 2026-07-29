import { describe, it, expect } from "vitest";
import {
  isInventoryTab,
  purchaseDraftLink,
  receiptLink,
  withQuery,
} from "../deepLink";

describe("withQuery", () => {
  it("returns a bare path when no params are set", () => {
    expect(withQuery("/inventory", {})).toBe("/inventory");
  });

  it("omits empty, null and undefined values", () => {
    expect(withQuery("/inventory", { tab: "receiving", receipt: undefined })).toBe(
      "/inventory?tab=receiving",
    );
    expect(withQuery("/inventory", { tab: "receiving", receipt: null })).toBe(
      "/inventory?tab=receiving",
    );
    expect(withQuery("/inventory", { tab: "" })).toBe("/inventory");
  });

  it("encodes values", () => {
    expect(withQuery("/x", { q: "a b&c" })).toBe("/x?q=a+b%26c");
  });
});

describe("isInventoryTab", () => {
  it("accepts the real tab values", () => {
    for (const tab of ["stock", "smart", "replenishment", "receiving", "transfers"]) {
      expect(isInventoryTab(tab)).toBe(true);
    }
  });

  it("rejects unknown values and null so a bad URL falls back to the default tab", () => {
    expect(isInventoryTab("receiving-tab")).toBe(false);
    expect(isInventoryTab("")).toBe(false);
    expect(isInventoryTab(null)).toBe(false);
  });
});

describe("cross-stage links", () => {
  const id = "3f8c1b2a-0000-4000-8000-000000000000";

  it("points a receipt link at the Receiving tab with the receipt to open", () => {
    expect(receiptLink(id)).toBe(`/inventory?tab=receiving&receipt=${id}`);
  });

  it("selects a tab that inventory recognises", () => {
    const tab = new URLSearchParams(receiptLink(id).split("?")[1]).get("tab");
    expect(isInventoryTab(tab)).toBe(true);
  });

  it("points a draft link at the drafts page with the draft to open", () => {
    expect(purchaseDraftLink(id)).toBe(`/purchase-drafts?draft=${id}`);
  });
});
