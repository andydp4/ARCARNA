import { useEffect } from "react";
import { useUser } from "@clerk/clerk-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useLocation } from "wouter";
import {
  type AuthRuntime,
  clerkAccountPortalUrl,
  usesClerkAccountPortal,
} from "@/lib/authConfig";

type ClerkSignInPanelProps = {
  /** Immediately redirect to Clerk Account Portal when not signed in. */
  autoRedirect?: boolean;
  portalPath?: "/sign-in" | "/sign-up";
};

/**
 * Sends users to Clerk Account Portal (accounts.{domain}) when configured.
 * Session is established on return to viger.cloud via redirect_url.
 */
export function ClerkSignInPanel({
  autoRedirect = false,
  portalPath = "/sign-in",
}: ClerkSignInPanelProps) {
  const [, setLocation] = useLocation();
  const { data: runtime } = useQuery<AuthRuntime>({
    queryKey: ["/api/auth/runtime"],
    queryFn: async () => {
      const res = await fetch("/api/auth/runtime", { credentials: "include" });
      return res.json();
    },
  });

  const { isSignedIn, isLoaded } = useUser();
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

  if (isSignedIn) {
    return (
      <Button
        className="w-full min-h-[44px]"
        onClick={() => setLocation("/")}
        data-testid="button-continue"
      >
        Continue to dashboard
      </Button>
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
