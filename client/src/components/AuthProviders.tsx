import { ClerkProvider } from "@clerk/clerk-react";
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  type AuthRuntime,
  resolveAuthProvider,
  resolveClerkPublishableKey,
  appUrl,
} from "@/lib/authConfig";

export type AuthConfig = {
  provider: "clerk" | "replit";
  publishableKey: string | null;
  /** True when children are wrapped in ClerkProvider. */
  clerkReady: boolean;
  runtimeLoaded: boolean;
};

const AuthConfigContext = createContext<AuthConfig>({
  provider: "clerk",
  publishableKey: null,
  clerkReady: false,
  runtimeLoaded: false,
});

export function useAuthConfig(): AuthConfig {
  return useContext(AuthConfigContext);
}

/**
 * Wraps the app in ClerkProvider when AUTH_PROVIDER=clerk and a publishable key exists.
 * Vite env is used immediately so Clerk mounts before /api/auth/runtime returns.
 */
export function AuthProviders({ children }: { children: ReactNode }) {
  const { data, isLoading } = useQuery<AuthRuntime>({
    queryKey: ["/api/auth/runtime"],
    queryFn: async () => {
      const res = await fetch("/api/auth/runtime", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load auth runtime");
      return res.json();
    },
    staleTime: 60_000,
  });

  const config = useMemo<AuthConfig>(() => {
    const provider = resolveAuthProvider(data);
    const publishableKey = resolveClerkPublishableKey(data);
    const clerkReady = provider === "clerk" && !!publishableKey;
    return {
      provider,
      publishableKey,
      clerkReady,
      runtimeLoaded: !isLoading,
    };
  }, [data, isLoading]);

  const content = (
    <AuthConfigContext.Provider value={config}>{children}</AuthConfigContext.Provider>
  );

  if (config.clerkReady && config.publishableKey) {
    return (
      <ClerkProvider
        publishableKey={config.publishableKey}
        afterSignOutUrl={appUrl("/")}
        signInUrl={appUrl("/sign-in")}
        signUpUrl={appUrl("/sign-in")}
        signInFallbackRedirectUrl={appUrl("/")}
        signUpFallbackRedirectUrl={appUrl("/")}
      >
        {content}
      </ClerkProvider>
    );
  }

  return content;
}
