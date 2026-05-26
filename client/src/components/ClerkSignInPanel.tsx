import { useEffect } from "react";
import { apiFetch } from "@/lib/appPaths";
import { useUser } from "@clerk/clerk-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useEnterApp } from "@/hooks/useEnterApp";
import {
  type AuthRuntime,
  clerkAccountPortalUrl,
  usesClerkAccountPortal,
} from "@/lib/authConfig";

type ClerkSignInPanelProps = {
  autoRedirect?: boolean;
  portalPath?: "/sign-in" | "/sign-up";
};

export function ClerkSignInPanel({
  autoRedirect = false,
  portalPath = "/sign-in",
}: ClerkSignInPanelProps) {
  const { data: runtime } = useQuery<AuthRuntime>({
    queryKey: ["/api/auth/runtime"],
    queryFn: async () => {
      const res = await apiFetch("/api/auth/runtime", { credentials: "include" });
      return res.json();
    },
  });

  const { isSignedIn, isLoaded } = useUser();
  const { enterApp, syncing, syncError, clerkSignedIn } = useEnterApp({ autoRedirect });
  const portalUrl = clerkAccountPortalUrl(portalPath, "/", runtime);
  const accountPortal = usesClerkAccountPortal(runtime);

  useEffect(() => {
    if (autoRedirect && isLoaded && !isSignedIn && portalUrl) {
      window.location.href = portalUrl;
    }
  }, [autoRedirect, isLoaded, isSignedIn, portalUrl]);

  if (!isLoaded) {
    return (
      <Button disabled className="w-full min-h-[44px]">
        Loading sign-in…
      </Button>
    );
  }

  if (clerkSignedIn) {
    return (
      <div className="space-y-3">
        <Button
          type="button"
          className="w-full min-h-[44px]"
          disabled={syncing}
          onClick={() => {
            void enterApp();
          }}
          data-testid="button-continue"
        >
          {syncing ? "Opening dashboard…" : "Continue to dashboard"}
        </Button>
        {syncError && (
          <Alert variant="destructive">
            <AlertTitle>Could not open dashboard</AlertTitle>
            <AlertDescription>{syncError}</AlertDescription>
          </Alert>
        )}
      </div>
    );
  }

  if (!accountPortal || !portalUrl) {
    return (
      <Alert variant="destructive" data-testid="alert-clerk-accounts-url-missing">
        <AlertTitle>Account Portal not configured</AlertTitle>
        <AlertDescription>
          Set <code className="text-xs">CLERK_ACCOUNTS_URL</code> and{" "}
          <code className="text-xs">VITE_CLERK_ACCOUNTS_URL</code> to{" "}
          <code className="text-xs">https://accounts.viger.cloud</code>, then rebuild and
          restart PM2.
        </AlertDescription>
      </Alert>
    );
  }

  if (autoRedirect) {
    return (
      <Button disabled className="w-full min-h-[44px]">
        Redirecting to sign-in…
      </Button>
    );
  }

  return (
    <Button
      type="button"
      className="w-full min-h-[44px] bg-secondary hover:bg-blue-600 text-white font-medium"
      onClick={() => {
        window.location.href = portalUrl;
      }}
      data-testid="button-clerk-account-portal"
    >
      Sign in
    </Button>
  );
}
