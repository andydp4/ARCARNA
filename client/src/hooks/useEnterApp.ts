import { useCallback, useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/clerk-react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchAuthUser } from "@/hooks/useAuth";
import { isMidnightAppPath, navigateToAppEntry } from "@/lib/authNavigation";
import { resolveAppPath } from "@/lib/appPaths";
import { useAuth } from "@/hooks/useAuth";

/**
 * After Clerk Account Portal sign-in, sync /api/auth/user and enter the protected app.
 */
export function useEnterApp(options?: { autoRedirect?: boolean }) {
  const autoRedirect = options?.autoRedirect ?? false;
  const { isSignedIn, isLoaded: clerkLoaded } = useUser();
  const { isAuthenticated, isLoading: apiLoading, user } = useAuth();
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const autoAttempted = useRef(false);

  const enterApp = useCallback(async (): Promise<boolean> => {
    setSyncing(true);
    setSyncError(null);

    try {
      console.info("[auth] Syncing server session after Clerk sign-in…");
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      const authUser = await queryClient.fetchQuery({
        queryKey: ["/api/auth/user"],
        queryFn: fetchAuthUser,
        staleTime: 0,
      });

      if (!authUser) {
        const message =
          "Signed in with Clerk, but the server session is not ready. You may need allow-list approval — try again in a moment.";
        console.warn("[auth] Clerk session active; /api/auth/user returned null");
        setSyncError(message);
        return false;
      }

      return navigateToAppEntry(authUser, "auth");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not complete sign-in";
      console.error("[auth] enterApp failed:", err);
      setSyncError(message);
      return false;
    } finally {
      setSyncing(false);
    }
  }, [queryClient]);

  useEffect(() => {
    if (!autoRedirect || !clerkLoaded || !isSignedIn || autoAttempted.current) return;
    if (apiLoading) return;

    if (isAuthenticated && user) {
      autoAttempted.current = true;
      const path = window.location.pathname;
      const entry = resolveAppPath("/");
      const signIn = resolveAppPath("/sign-in");
      if (path === entry || path === signIn || !isMidnightAppPath(path)) {
        navigateToAppEntry(user, "auth-auto");
      }
      return;
    }

    autoAttempted.current = true;
    void enterApp();
  }, [
    autoRedirect,
    clerkLoaded,
    isSignedIn,
    isAuthenticated,
    apiLoading,
    user,
    enterApp,
  ]);

  return {
    enterApp,
    syncing,
    syncError,
    clerkSignedIn: clerkLoaded && isSignedIn,
    apiReady: isAuthenticated,
  };
}
