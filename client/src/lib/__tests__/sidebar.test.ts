import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SIDEBAR_CLOSE_DELAY_MS,
  closesOnOutsidePointer,
  closesOnToggleLeave,
  opensOnPointerEnter,
  readPinned,
  sidebarLayout,
  sidebarMode,
  writePinned,
} from "../sidebar";

describe("sidebar behaviour", () => {
  it("picks hover on a laptop, tap on a tablet and the sheet on a phone", () => {
    expect(sidebarMode({ isPhone: false, canHover: true })).toBe("hover");
    expect(sidebarMode({ isPhone: false, canHover: false })).toBe("tap");
    expect(sidebarMode({ isPhone: true, canHover: true })).toBe("phone");
  });

  it("closes half a second after the pointer leaves", () => {
    expect(SIDEBAR_CLOSE_DELAY_MS).toBe(500);
  });

  it("overlays the page when open and unpinned, and pushes it when pinned", () => {
    expect(sidebarLayout({ mode: "hover", pinned: false, open: false })).toEqual({ expanded: false, pushesContent: false });
    expect(sidebarLayout({ mode: "hover", pinned: false, open: true })).toEqual({ expanded: true, pushesContent: false });
    expect(sidebarLayout({ mode: "hover", pinned: true, open: false })).toEqual({ expanded: true, pushesContent: true });
    expect(sidebarLayout({ mode: "tap", pinned: true, open: false })).toEqual({ expanded: true, pushesContent: true });
    expect(sidebarLayout({ mode: "phone", pinned: true, open: false }).pushesContent).toBe(false);
  });

  it("opens on a mouse hover but never on a touch", () => {
    expect(opensOnPointerEnter("hover", "mouse")).toBe(true);
    expect(opensOnPointerEnter("hover", "touch")).toBe(false);
    expect(opensOnPointerEnter("tap", "mouse")).toBe(false);
  });

  describe("pin storage", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("remembers the pin on the device", () => {
      const store = new Map<string, string>();
      vi.stubGlobal("localStorage", {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      });
      expect(readPinned()).toBe(false);
      writePinned(true);
      expect(readPinned()).toBe(true);
      writePinned(false);
      expect(readPinned()).toBe(false);
    });

    it("never throws when storage is blocked", () => {
      vi.stubGlobal("localStorage", {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      });
      expect(readPinned()).toBe(false);
      expect(() => writePinned(true)).not.toThrow();
    });
  });
});

describe("closing an overlay nobody is using", () => {
  it("closes on a click or tap outside in hover and tap modes, unless pinned", () => {
    expect(closesOnOutsidePointer("hover", false)).toBe(true);
    expect(closesOnOutsidePointer("tap", false)).toBe(true);
    expect(closesOnOutsidePointer("hover", true)).toBe(false);
    expect(closesOnOutsidePointer("tap", true)).toBe(false);
    // Phones use the sheet, which handles its own outside taps.
    expect(closesOnOutsidePointer("phone", false)).toBe(false);
  });

  it("starts the close timer when a mouse leaves the menu button without entering the sidebar", () => {
    expect(closesOnToggleLeave("hover", false, "mouse")).toBe(true);
    expect(closesOnToggleLeave("hover", false, "pen")).toBe(true);
    expect(closesOnToggleLeave("hover", true, "mouse")).toBe(false);
    expect(closesOnToggleLeave("hover", false, "touch")).toBe(false);
    expect(closesOnToggleLeave("tap", false, "mouse")).toBe(false);
  });
});
