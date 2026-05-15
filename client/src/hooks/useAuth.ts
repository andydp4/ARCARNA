import { useQuery } from "@tanstack/react-query";

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

export function useAuth() {
  const { data: user, isLoading, error } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/user"],
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
