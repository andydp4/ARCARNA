import { describe, expect, it } from "vitest";
import { LEGACY_OFFLINE_DB_NAME, offlineDbNameForOrg } from "../offline-storage";

describe("offlineDbNameForOrg", () => {
  it("namespaces IndexedDB per tenant", () => {
    expect(offlineDbNameForOrg("org_abc")).toBe("arcarna-epos-db--org_abc");
    expect(offlineDbNameForOrg("org_abc")).not.toBe(LEGACY_OFFLINE_DB_NAME);
  });
});
