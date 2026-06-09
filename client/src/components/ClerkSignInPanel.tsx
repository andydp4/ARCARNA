import { useEffect } from "react";
import { apiFetch } from "@/lib/appPaths";
import { useClerk, useUser } from "@clerk/clerk-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useEnterApp } from "@/hooks/useEnterApp";
import {
  type AuthRuntime,
  clerkAccountPortalUrl,
  usesClerkAccountPortal,
  usesClerkCrossHostAccountPortal,
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
  const { loaded: clerkLoaded, buildSignInUrl, buildSignUpUrl } = useClerk();
  const { enterApp, syncing, syncError, clerkSignedIn } = useEnterApp({ autoRedirect });
  const portalUrl = clerkAccountPortalUrl(portalPath, "/", runtime);
  const accountPortal = usesClerkAccountPortal(runtime);
  const crossHostPortal = usesClerkCrossHostAccountPortal(runtime);

  const authUrl =
    crossHostPortal && clerkLoaded
      ? portalPath === "/sign-up"
        ? buildSignUpUrl()
        : buildSignInUrl()
      : portalUrl;

  useEffect(() => {
    if (!autoRedirect || !isLoaded || isSignedIn || !authUrl) return;
    // Wait for Clerk SDK so buildSignInUrl can attach link_domain / sync params.
    if (crossHostPortal && !clerkLoaded) return;
    window.location.href = authUrl;
  }, [autoRedirect, isLoaded, isSignedIn, authUrl, crossHostPortal, clerkLoaded]);

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
          className="w-full min-h-[44px] lm-btn-metal font-medium"
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

  if (!accountPortal || !authUrl) {
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
        {crossHostPortal && !clerkLoaded ? "Preparing sign-in…" : "Redirecting to sign-in…"}
      </Button>
    );
  }

  return (
    <Button
      type="button"
      className="w-full min-h-[44px] lm-btn-metal font-medium"
      onClick={() => {
        window.location.href = authUrl;
      }}
      data-testid="button-clerk-account-portal"
    >
      Sign in
    </Button>
  );
}
