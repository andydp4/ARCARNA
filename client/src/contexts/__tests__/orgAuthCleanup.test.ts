import { describe, expect, it } from "vitest";
import { shouldWipeOfflineDataForAuthState } from "../OrgContext";

describe("shouldWipeOfflineDataForAuthState", () => {
  it("does not wipe offline data while auth is still loading", () => {
    expect(
      shouldWipeOfflineDataForAuthState({
        user: null,
        isLoading: true,
        error: null,
      }),
    ).toBe(false);
  });

  it("does not wipe offline data when auth failed transiently", () => {
    expect(
      shouldWipeOfflineDataForAuthState({
        user: null,
        isLoading: false,
        error: new Error("Auth service unavailable"),
      }),
    ).toBe(false);
  });

  it("wipes offline data after auth settles as unauthenticated", () => {
    expect(
      shouldWipeOfflineDataForAuthState({
        user: null,
        isLoading: false,
        error: null,
      }),
    ).toBe(true);
  });

  it("does not wipe offline data for an authenticated user", () => {
    expect(
      shouldWipeOfflineDataForAuthState({
        user: {
          id: "seed-cashier",
          role: "CASHIER",
          orgId: "org_123",
        },
        isLoading: false,
        error: null,
      }),
    ).toBe(false);
  });
});
