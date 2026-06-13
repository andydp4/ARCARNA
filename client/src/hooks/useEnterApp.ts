import { useCallback, useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/clerk-react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { AuthUser } from "@/hooks/useAuth";
import { apiFetch } from "@/lib/appPaths";
import { isAppBasePath, navigateToAppEntry } from "@/lib/authNavigation";
import { resolveAppPath } from "@/lib/appPaths";
import { useAuth } from "@/hooks/useAuth";
import { waitForClerkToken } from "@/lib/clerkApiAuth";

const AUTH_SYNC_ATTEMPTS = 4;
const AUTH_SYNC_RETRY_MS = 750;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ProbeResult =
  | { kind: "ok"; user: AuthUser }
  | { kind: "pending" }
  | { kind: "rejected" }
  | { kind: "unauthorized" }
  | { kind: "error"; status: number };

/**
 * Probe /api/auth/user with a plain fetch — deliberately NOT through react-query.
 * Going through fetchQuery here is unsafe: any concurrent invalidateQueries on the
 * same key (ClerkSessionSync, a second enterApp run) cancels the in-flight fetch
 * and rejects with TanStack's CancelledError, aborting sign-in with a useless error.
 */
async function probeServerSession(): Promise<ProbeResult> {
  const res = await apiFetch("/api/auth/user", {
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  if (res.ok) {
    return { kind: "ok", user: (await res.json()) as AuthUser };
  }
  if (res.status === 401) return { kind: "unauthorized" };
  if (res.status === 403) {
    const body = (await res.json().catch(() => ({}))) as {
      code?: string;
      isPending?: boolean;
    };
    if (body.code === "PENDING_APPROVAL" || body.isPending) return { kind: "pending" };
    return { kind: "rejected" };
  }
  return { kind: "error", status: res.status };
}

function describeAttempt(hadToken: boolean, result: ProbeResult): string {
  const token = hadToken ? "token" : "no-token";
  switch (result.kind) {
    case "ok":
      return `${token}→ok`;
    case "pending":
      return `${token}→403-pending`;
    case "rejected":
      return `${token}→403-rejected`;
    case "unauthorized":
      return `${token}→401`;
    case "error":
      return `${token}→${result.status}`;
  }
}

const PENDING_USER: AuthUser = {
  id: "pending",
  role: "CASHIER",
  orgId: null,
  accessState: "pending",
  isPending: true,
};

/** Single-flight across all hook instances (auto-run effect + button click). */
let activeSync: Promise<boolean> | null = null;

async function syncAndEnter(
  queryClient: QueryClient,
  setSyncError: (message: string | null) => void,
): Promise<boolean> {
  const attempts: string[] = [];
  let everHadToken = false;
  let lastResult: ProbeResult = { kind: "unauthorized" };

  console.info("[auth] Syncing server session after Clerk sign-in…");

  for (let attempt = 1; attempt <= AUTH_SYNC_ATTEMPTS; attempt++) {
    const token = await waitForClerkToken({
      timeoutMs: attempt === 1 ? 8_000 : 3_000,
    });
    const hadToken = !!token;
    everHadToken = everHadToken || hadToken;

    try {
      lastResult = await probeServerSession();
    } catch (err) {
      // Network-level failure (offline, DNS, proxy). Record and retry.
      const message = err instanceof Error ? err.message : String(err);
      attempts.push(`${hadToken ? "token" : "no-token"}→fetch-failed(${message})`);
      console.warn(`[auth] enterApp attempt ${attempt} network failure:`, err);
      if (attempt < AUTH_SYNC_ATTEMPTS) await sleep(AUTH_SYNC_RETRY_MS * attempt);
      lastResult = { kind: "error", status: 0 };
      continue;
    }

    attempts.push(describeAttempt(hadToken, lastResult));
    console.info(`[auth] enterApp attempt ${attempt}: ${attempts[attempts.length - 1]}`);

    if (lastResult.kind === "ok") {
      queryClient.setQueryData(["/api/auth/user"], lastResult.user);
      return navigateToAppEntry(lastResult.user, "auth");
    }
    if (lastResult.kind === "pending") {
      queryClient.setQueryData(["/api/auth/user"], PENDING_USER);
      return navigateToAppEntry(PENDING_USER, "auth");
    }
    if (lastResult.kind === "rejected") {
      setSyncError("Your access request was rejected. Contact your administrator.");
      return false;
    }

    if (attempt < AUTH_SYNC_ATTEMPTS) {
      await sleep(AUTH_SYNC_RETRY_MS * attempt);
    }
  }

  const trace = `Attempts: ${attempts.join(", ")}`;
  console.warn(`[auth] enterApp exhausted retries. ${trace}`);

  if (lastResult.kind === "error") {
    setSyncError(
      `The server failed while checking your session (HTTP ${lastResult.status || "network error"}). ` +
        `This is a server-side problem — check PM2 logs / Sentry. ${trace}`,
    );
  } else if (!everHadToken) {
    setSyncError(
      "Clerk reports you are signed in, but never issued a session token to this page, " +
        "so API requests were sent unauthenticated and rejected (HTTP 401). " +
        "Hard-refresh this page; if it persists, check requests to the Clerk frontend API " +
        `(clerk.* domain) in DevTools → Network. ${trace}`,
    );
  } else {
    setSyncError(
      "The server rejected the Clerk session token (HTTP 401). " +
        "Verify CLERK_SECRET_KEY / CLERK_PUBLISHABLE_KEY on the server match the " +
        `instance used by the frontend, then restart PM2. ${trace}`,
    );
  }
  return false;
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

  const enterApp = useCallback(async (): Promise<boolean> => {
    setSyncing(true);
    setSyncError(null);

    try {
      // Join an in-flight sync instead of racing it — concurrent loops used to
      // cancel each other's queries (surfaced to users as "CancelledError").
      if (!activeSync) {
        activeSync = syncAndEnter(queryClient, setSyncError).finally(() => {
          activeSync = null;
        });
      }
      return await activeSync;
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
      if (path === entry || path === signIn || !isAppBasePath(path)) {
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
