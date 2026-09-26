import { describe, it, expect } from "vitest";
import {
  CENTRE_TOUR_CENTRES,
  FEATURE_TOURS,
  centreTourAccountKey,
  centreTourLocalKey,
  featureTourAccountKey,
  featureTourLocalKey,
  isUiSeenKey,
  opsTourAccountKey,
  whatsNewAccountKey,
} from "./uiSeen";

describe("isUiSeenKey", () => {
  it("accepts the namespaced keys the app writes", () => {
    expect(isUiSeenKey(whatsNewAccountKey("1.1.0"))).toBe(true);
    expect(isUiSeenKey(whatsNewAccountKey("1.2.0"))).toBe(true);
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

describe("centreTourLocalKey", () => {
  it("is the per-device flag CentreTour reads, one per toured Centre", () => {
    expect(centreTourLocalKey("stock")).toBe("arcarna.centreTour:stock-1.2.0");
    expect(CENTRE_TOUR_CENTRES).not.toContain("operations");
    expect(new Set(CENTRE_TOUR_CENTRES.map((c) => centreTourLocalKey(c))).size).toBe(CENTRE_TOUR_CENTRES.length);
  });
});

describe("featureTourAccountKey", () => {
  it("names each v1.2 feature tour by feature and version, and passes the server's key check", () => {
    expect(featureTourAccountKey("myRun")).toBe("featureTour:myRun-1.2.0");
    for (const feature of FEATURE_TOURS) {
      expect(isUiSeenKey(featureTourAccountKey(feature))).toBe(true);
      expect(featureTourLocalKey(feature)).toBe(`arcarna.featureTour:${feature}-1.2.0`);
    }
    expect(new Set(FEATURE_TOURS).size).toBe(FEATURE_TOURS.length);
  });

  it("never collides with a Centre tour's key", () => {
    const centre = new Set(CENTRE_TOUR_CENTRES.map((c) => centreTourLocalKey(c)));
    for (const feature of FEATURE_TOURS) expect(centre.has(featureTourLocalKey(feature))).toBe(false);
  });
});
