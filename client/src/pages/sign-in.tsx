import { useQuery } from "@tanstack/react-query";
import { apiFetch, resolveApiUrl, resolveAppPath } from "@/lib/appPaths";
import { useClerk, useUser } from "@clerk/clerk-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAuthConfig } from "@/components/AuthProviders";
import { ClerkSignInPanel } from "@/components/ClerkSignInPanel";
import { type AuthRuntime, isClerkMode } from "@/lib/authConfig";
import { useEffect, useRef } from "react";

/** Redirects to Clerk Account Portal (accounts.viger.cloud) when configured. */
export default function SignInPage() {
  const { clerkReady, publishableKey } = useAuthConfig();
  const { signOut } = useClerk();
  const { isLoaded: clerkLoaded, isSignedIn } = useUser();
  const logoutAttempted = useRef(false);
  const { data: runtime } = useQuery<AuthRuntime>({
    queryKey: ["/api/auth/runtime"],
    queryFn: async () => {
      const res = await apiFetch("/api/auth/runtime", { credentials: "include" });
      return res.json();
    },
  });

  if (!isClerkMode(runtime)) {
    window.location.href = resolveApiUrl("/api/login");
    return null;
  }

  useEffect(() => {
    if (!clerkLoaded || !isClerkMode(runtime) || logoutAttempted.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("logout") !== "1") return;
    logoutAttempted.current = true;
    if (!isSignedIn) {
      window.location.replace(resolveAppPath("/sign-in"));
      return;
    }
    void signOut({ redirectUrl: resolveAppPath("/sign-in") });
  }, [clerkLoaded, isSignedIn, runtime, signOut]);

  if (!publishableKey) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary via-slate-800 to-slate-900 px-4">
        <div className="w-full max-w-md">
          <Alert variant="destructive">
            <AlertTitle>Sign-in unavailable</AlertTitle>
            <AlertDescription>
              Clerk publishable key is missing. Configure{" "}
              <code className="text-xs">VITE_CLERK_PUBLISHABLE_KEY</code> and rebuild, or set{" "}
              <code className="text-xs">CLERK_PUBLISHABLE_KEY</code> in server{" "}
              <code className="text-xs">.env</code>.
            </AlertDescription>
          </Alert>
          <Button className="mt-4 w-full" variant="outline" onClick={() => { window.location.href = resolveAppPath("/"); }}>
            Back to home
          </Button>
        </div>
      </div>
    );
  }

  if (!clerkReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary via-slate-800 to-slate-900 px-4">
        <Button disabled className="w-full max-w-md min-h-[44px]">
          Loading sign-in…
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary via-slate-800 to-slate-900 px-4">
      <div className="w-full max-w-md rounded-lg bg-card p-6 shadow-2xl text-center">
        <ClerkSignInPanel autoRedirect portalPath="/sign-in" />
      </div>
    </div>
  );
}
