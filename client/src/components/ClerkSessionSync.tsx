import { useEffect } from "react";
import { useUser } from "@clerk/clerk-react";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { waitForClerkToken } from "@/lib/clerkApiAuth";

export async function invalidateAuthUserAfterClerkToken(
  queryClient: QueryClient,
  waitForToken: typeof waitForClerkToken = waitForClerkToken,
): Promise<boolean> {
  const token = await waitForToken({ timeoutMs: 10_000, intervalMs: 250 });
  if (!token) return false;
  await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
  return true;
}

/** Refetch /api/auth/user when Clerk client session becomes active. */
export function ClerkSessionSync() {
  const queryClient = useQueryClient();
  const { isSignedIn, isLoaded } = useUser();

  useEffect(() => {
    let cancelled = false;
    if (isLoaded && isSignedIn) {
      void invalidateAuthUserAfterClerkToken(queryClient, async (options) => {
        const token = await waitForClerkToken(options);
        return cancelled ? null : token;
      });
    }
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, queryClient]);

  return null;
}
