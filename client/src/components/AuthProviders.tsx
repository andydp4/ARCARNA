import { ClerkProvider } from "@clerk/clerk-react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

type AuthRuntime = {
  authProvider?: "clerk" | "replit";
  clerkPublishableKey?: string | null;
};

/**
 * Wraps the app in ClerkProvider when AUTH_PROVIDER=clerk.
 * Publishable key: runtime API first, then VITE_CLERK_PUBLISHABLE_KEY from build.
 */
export function AuthProviders({ children }: { children: ReactNode }) {
  const { data } = useQuery<AuthRuntime>({
    queryKey: ["/api/auth/runtime"],
    queryFn: async () => {
      const res = await fetch("/api/auth/runtime", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load auth runtime");
      return res.json();
    },
    staleTime: 60_000,
  });

  const publishableKey =
    data?.clerkPublishableKey ??
    import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ??
    null;

  const useClerk =
    data?.authProvider === "clerk" ||
    (!data?.authProvider && import.meta.env.VITE_AUTH_PROVIDER !== "replit");

  if (useClerk && publishableKey) {
    return (
      <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
        {children}
      </ClerkProvider>
    );
  }

  return <>{children}</>;
}
