import { describe, it, expect } from "vitest";
import { centreTourAccountKey, isUiSeenKey, opsTourAccountKey, whatsNewAccountKey } from "./uiSeen";

describe("isUiSeenKey", () => {
  it("accepts the namespaced keys the app writes", () => {
    expect(isUiSeenKey(whatsNewAccountKey("1.1.0"))).toBe(true);
    expect(isUiSeenKey(opsTourAccountKey("1.2.0-beta.1"))).toBe(true);
    expect(isUiSeenKey("tutorial:stockCentre")).toBe(true);
  });

  it("rejects anything that is not a namespaced key", () => {
    expect(isUiSeenKey("")).toBe(false);
    expect(isUiSeenKey("whatsNew")).toBe(false);
    expect(isUiSeenKey("whatsNew:")).toBe(false);
    expect(isUiSeenKey(":1.1.0")).toBe(false);
    expect(isUiSeenKey("whats new:1.1.0")).toBe(false);
    expect(isUiSeenKey("whatsNew:1.1.0; drop table")).toBe(false);
    expect(isUiSeenKey(`whatsNew:${"x".repeat(200)}`)).toBe(false);
    expect(isUiSeenKey(42)).toBe(false);
  });
});

describe("centreTourAccountKey", () => {
  it("names each Centre's tour by Centre and version, and passes the server's key check", () => {
    for (const centre of ["control", "operations", "stock", "truths", "customer", "finance", "settings"]) {
      const key = centreTourAccountKey(centre);
      expect(key).toBe(`centreTour:${centre}-1.2.0`);
      expect(isUiSeenKey(key)).toBe(true);
    }
  });
});
