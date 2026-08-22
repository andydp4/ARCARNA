import { describe, expect, it } from "vitest";
import { formatOrderChannel, isWebsiteOrder, normalizeOrderChannel } from "./channel";

describe("order channel helpers", () => {
  it("normalizes blank channels to POS", () => {
    expect(normalizeOrderChannel(undefined)).toBe("pos");
    expect(normalizeOrderChannel("")).toBe("pos");
    expect(formatOrderChannel(null)).toBe("POS");
  });

  it("labels website orders for the staff order tray", () => {
    expect(isWebsiteOrder("web")).toBe(true);
    expect(isWebsiteOrder("WEB")).toBe(true);
    expect(formatOrderChannel("web")).toBe("Website");
  });

  it("keeps unknown channels readable", () => {
    expect(formatOrderChannel("marketplace")).toBe("Marketplace");
  });
});
