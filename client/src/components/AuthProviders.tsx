import { ClerkProvider } from "@clerk/clerk-react";
import { apiFetch } from "@/lib/appPaths";
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { ClerkSessionSync } from "@/components/ClerkSessionSync";
import { ClerkTokenBridge } from "@/components/ClerkTokenBridge";
import {
  type AuthRuntime,
  resolveAuthProvider,
  resolveClerkPublishableKey,
  resolveClerkAccountsUrl,
  usesClerkSatelliteDomain,
  usesClerkCrossHostAccountPortal,
  clerkSatelliteDomain,
  clerkSatelliteRedirectOrigins,
  resolveClerkProxyUrl,
  appUrl,
} from "@/lib/authConfig";

export type AuthConfig = {
  provider: "clerk" | "replit";
  publishableKey: string | null;
  accountsUrl: string | null;
  clerkReady: boolean;
  runtimeLoaded: boolean;
};

const AuthConfigContext = createContext<AuthConfig>({
  provider: "clerk",
  publishableKey: null,
  accountsUrl: null,
  clerkReady: false,
  runtimeLoaded: false,
});

export function useAuthConfig(): AuthConfig {
  return useContext(AuthConfigContext);
}

export function AuthProviders({ children }: { children: ReactNode }) {
  const { data, isLoading } = useQuery<AuthRuntime>({
    queryKey: ["/api/auth/runtime"],
    queryFn: async () => {
      const res = await apiFetch("/api/auth/runtime", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load auth runtime");
      return res.json();
    },
    staleTime: 60_000,
  });

  const config = useMemo<AuthConfig>(() => {
    const provider = resolveAuthProvider(data);
    const publishableKey = resolveClerkPublishableKey(data);
    const accountsUrl = resolveClerkAccountsUrl(data);
    const clerkReady = provider === "clerk" && !!publishableKey;
    return {
      provider,
      publishableKey,
      accountsUrl,
      clerkReady,
      runtimeLoaded: !isLoading,
    };
  }, [data, isLoading]);

  const accountsBase = config.accountsUrl;
  const signInUrl = accountsBase ? `${accountsBase}/sign-in` : appUrl("/sign-in");
  const signUpUrl = accountsBase ? `${accountsBase}/sign-up` : appUrl("/sign-in");

  const content = (
    <AuthConfigContext.Provider value={config}>{children}</AuthConfigContext.Provider>
  );

  if (config.clerkReady && config.publishableKey) {
    const isSatellite = usesClerkSatelliteDomain(data);
    const satelliteDomain = clerkSatelliteDomain();
    const clerkCommon = {
      publishableKey: config.publishableKey,
      afterSignOutUrl: appUrl("/sign-out?done=1"),
      signInUrl: signInUrl,
      signUpUrl: signUpUrl,
      signInFallbackRedirectUrl: appUrl("/"),
      signUpFallbackRedirectUrl: appUrl("/"),
    };
    const clerkChildren = (
      <>
        <ClerkTokenBridge />
        <ClerkSessionSync />
        {content}
      </>
    );
    const clerkRouter = {
      routerPush: (to: string) => {
        window.location.assign(to);
      },
      routerReplace: (to: string) => {
        window.location.replace(to);
      },
    };

    const crossHostPortal = usesClerkCrossHostAccountPortal(data);
    const redirectOrigins = crossHostPortal ? clerkSatelliteRedirectOrigins(data) : undefined;

    if (isSatellite && satelliteDomain) {
      const proxyUrl = resolveClerkProxyUrl();
      const satelliteProps = proxyUrl
        ? { isSatellite: true as const, proxyUrl }
        : { isSatellite: true as const, domain: satelliteDomain };
      return (
        <ClerkProvider
          {...clerkCommon}
          {...satelliteProps}
          allowedRedirectOrigins={redirectOrigins}
          {...clerkRouter}
        >
          {clerkChildren}
        </ClerkProvider>
      );
    }

    if (crossHostPortal && redirectOrigins) {
      return (
        <ClerkProvider {...clerkCommon} allowedRedirectOrigins={redirectOrigins} {...clerkRouter}>
          {clerkChildren}
        </ClerkProvider>
      );
    }

    return <ClerkProvider {...clerkCommon}>{clerkChildren}</ClerkProvider>;
  }

  return content;
}
