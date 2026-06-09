import { useCallback, useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/clerk-react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchAuthUser } from "@/hooks/useAuth";
import { apiFetch } from "@/lib/appPaths";
import { isMidnightAppPath, navigateToAppEntry } from "@/lib/authNavigation";
import { resolveAppPath } from "@/lib/appPaths";
import { useAuth } from "@/hooks/useAuth";
import { waitForClerkToken } from "@/lib/clerkApiAuth";

const AUTH_SYNC_ATTEMPTS = 4;
const AUTH_SYNC_RETRY_MS = 750;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

  const resolvePendingOrError = useCallback(async (): Promise<boolean> => {
    let message =
      "Signed in with Clerk, but the server session is not ready. You may need allow-list approval — try again in a moment.";

    const token = await waitForClerkToken({ timeoutMs: 1500, intervalMs: 200 });
    if (!token) {
      message =
        "Clerk session is still syncing after sign-in. Wait a moment, then tap Continue to dashboard again.";
      setSyncError(message);
      return false;
    }

    try {
      const statusRes = await apiFetch("/api/auth/approval-status", {
        credentials: "include",
      });
      if (statusRes.ok) {
        const status = (await statusRes.json()) as {
          isPending?: boolean;
          isRejected?: boolean;
        };
        if (status.isPending) {
          return navigateToAppEntry(
            {
              id: "pending",
              role: "CASHIER",
              orgId: null,
              accessState: "pending",
              isPending: true,
            },
            "auth",
          );
        }
        if (status.isRejected) {
          message = "Your access request was rejected. Contact your administrator.";
        }
      } else if (statusRes.status === 401) {
        message =
          "Clerk session is still syncing after sign-in. Wait a moment, then tap Continue to dashboard again.";
      }
    } catch {
      // keep default message
    }

    console.warn("[auth] Clerk session active; /api/auth/user returned null");
    setSyncError(message);
    return false;
  }, []);

  const fetchServerSession = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    return queryClient.fetchQuery({
      queryKey: ["/api/auth/user"],
      queryFn: fetchAuthUser,
      staleTime: 0,
    });
  }, [queryClient]);

  const enterApp = useCallback(async (): Promise<boolean> => {
    setSyncing(true);
    setSyncError(null);

    try {
      console.info("[auth] Syncing server session after Clerk sign-in…");

      for (let attempt = 1; attempt <= AUTH_SYNC_ATTEMPTS; attempt++) {
        await waitForClerkToken({
          timeoutMs: attempt === 1 ? 8_000 : 3_000,
        });

        const authUser = await fetchServerSession();
        if (authUser) {
          return navigateToAppEntry(authUser, "auth");
        }

        if (attempt < AUTH_SYNC_ATTEMPTS) {
          await sleep(AUTH_SYNC_RETRY_MS * attempt);
        }
      }

      return resolvePendingOrError();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not complete sign-in";
      console.error("[auth] enterApp failed:", err);
      setSyncError(message);
      return false;
    } finally {
      setSyncing(false);
    }
  }, [fetchServerSession, resolvePendingOrError]);

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
