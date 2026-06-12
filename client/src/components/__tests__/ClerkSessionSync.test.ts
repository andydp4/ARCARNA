import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { invalidateAuthUserAfterClerkToken } from "../ClerkSessionSync";

describe("invalidateAuthUserAfterClerkToken", () => {
  it("does not invalidate /api/auth/user before Clerk exposes a token", async () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);

    const invalidated = await invalidateAuthUserAfterClerkToken(queryClient, async () => null);

    expect(invalidated).toBe(false);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("invalidates /api/auth/user once a Clerk token is available", async () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);

    const invalidated = await invalidateAuthUserAfterClerkToken(
      queryClient,
      async () => "session-token",
    );

    expect(invalidated).toBe(true);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["/api/auth/user"] });
  });
});
