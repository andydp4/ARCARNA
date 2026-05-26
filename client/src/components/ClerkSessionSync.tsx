import { useEffect } from "react";
import { useUser } from "@clerk/clerk-react";
import { useQueryClient } from "@tanstack/react-query";

/** Refetch /api/auth/user when Clerk client session becomes active. */
export function ClerkSessionSync() {
  const queryClient = useQueryClient();
  const { isSignedIn, isLoaded } = useUser();

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      void queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    }
  }, [isLoaded, isSignedIn, queryClient]);

  return null;
}
