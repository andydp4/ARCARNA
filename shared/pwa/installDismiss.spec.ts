import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { dismissPwaInstall, PWA_INSTALL_DISMISS_KEY } from "./installDismiss";

describe("dismissPwaInstall", () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      setItem(k: string, v: string) {
        store[k] = v;
      },
      getItem(k: string) {
        return store[k] ?? null;
      },
    } as Storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores dismiss expiry ~7 days ahead", () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    dismissPwaInstall(7);
    const until = parseInt(localStorage.getItem(PWA_INSTALL_DISMISS_KEY) ?? "0", 10);
    expect(until).toBeGreaterThan(now);
    expect(until).toBeLessThanOrEqual(now + 7 * 24 * 60 * 60 * 1000 + 1000);
  });
});
