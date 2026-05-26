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
  setupComplete?: boolean;
  needsSetupWizard?: boolean;
  runtime?: {
    devAuthBypass: boolean;
    nodeEnv: string;
  };
}

export async function fetchAuthUser(): Promise<AuthUser | null> {
  const res = await apiFetch("/api/auth/user", {
    credentials: "include",
    headers: { Accept: "application/json" },
  });

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
    retry: false,
  });

  return {
    user: user ?? null,
    isLoading,
    error,
    isAuthenticated: !!user,
    accessState: user?.accessState ?? "ok",
    needsOnboarding: !!user?.needsOnboarding,
    needsSetupWizard: !!user?.needsSetupWizard,
    setupComplete: user?.setupComplete !== false,
    devAuthBypass: !!user?.runtime?.devAuthBypass,
  };
}
