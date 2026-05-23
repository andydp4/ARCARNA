import { ClerkProvider } from "@clerk/clerk-react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

type AuthRuntime = {
  authProvider?: "clerk" | "replit";
  clerkPublishableKey?: string | null;
};

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

  if (data?.authProvider === "clerk" && data.clerkPublishableKey) {
    return (
      <ClerkProvider publishableKey={data.clerkPublishableKey} afterSignOutUrl="/">
        {children}
      </ClerkProvider>
    );
  }

  return <>{children}</>;
}
