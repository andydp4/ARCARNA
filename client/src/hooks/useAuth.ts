import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/appPaths";

export type AccessState = "ok" | "pending" | "no_org" | "no_access";

export interface AuthUser {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  role: string;
  orgId: string | null;
  orgName?: string | null;
  isAllowed?: boolean;
  isPending?: boolean;
  accessState?: AccessState;
  needsOnboarding?: boolean;
  needsOrgOnboarding?: boolean;
  setupComplete?: boolean;
  needsSetupWizard?: boolean;
  runtime?: {
    devAuthBypass: boolean;
    nodeEnv: string;
    authProvider?: string;
  };
  clerkTwoFactorEnabled?: boolean | null;
}

/**
 * How long to wait for the server to say who you are before giving up on that
 * attempt. Without a bound this request can hang indefinitely, and a hanging
 * auth request is not a neutral state: `isLoading` stays true, the router drops
 * every authenticated route, and the app answers "This route does not exist" to
 * a perfectly real page. On a counter tablet with a poor connection that reads
 * as the system being broken.
 */
const AUTH_REQUEST_TIMEOUT_MS = 10_000;

export async function fetchAuthUser(): Promise<AuthUser | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), AUTH_REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await apiFetch("/api/auth/user", {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal: abort.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401) return null;

  if (res.status === 403) {
    const body = (await res.json().catch(() => ({}))) as {
      code?: string;
      isPending?: boolean;
    };
    if (body.code === "PENDING_APPROVAL" || body.isPending) {
      return {
        id: "pending",
        role: "CASHIER",
        orgId: null,
        accessState: "pending",
        isPending: true,
        isAllowed: false,
      };
    }
    return null;
  }

  if (res.status >= 500) {
    console.error(`[auth] /api/auth/user unavailable: ${res.status} ${res.statusText}`);
    throw new Error(`Auth service unavailable (${res.status})`);
  }

  if (!res.ok) {
    throw new Error(`${res.status}: ${res.statusText}`);
  }

  return res.json();
}

export function useAuth() {
  const { data: user, isLoading, error } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchAuthUser,
    /**
     * A `null` answer means the server said you are not signed in. That is
     * data, not an error, and React Query never retries it.
     *
     * A throw means the opposite: the server did not answer, or answered 5xx,
     * and we do not know. Those are worth retrying, because "we don't know" is
     * treated by the router as "not signed in" — one dropped request and every
     * page in the app becomes a 404 that never recovers.
     */
    retry: 2,
    retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 4000),
  });

  return {
    user: user ?? null,
    isLoading,
    error,
    isAuthenticated: !!user,
    accessState: user?.accessState ?? "ok",
    needsOnboarding: !!user?.needsOnboarding,
    needsOrgOnboarding: !!user?.needsOrgOnboarding,
    needsSetupWizard: !!user?.needsSetupWizard,
    setupComplete: user?.setupComplete !== false,
    devAuthBypass: !!user?.runtime?.devAuthBypass,
  };
}
