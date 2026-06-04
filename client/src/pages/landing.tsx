import { useQuery } from "@tanstack/react-query";
import { apiFetch, resolveApiUrl } from "@/lib/appPaths";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuthConfig } from "@/components/AuthProviders";
import { ClerkSignInPanel } from "@/components/ClerkSignInPanel";
import { AuthShell } from "@/components/AuthShell";
import {
  type AuthRuntime,
  isClerkMode,
} from "@/lib/authConfig";

export default function Landing() {
  const { clerkReady, publishableKey, runtimeLoaded } = useAuthConfig();
  const { data: runtime, isLoading } = useQuery<AuthRuntime>({
    queryKey: ["/api/auth/runtime"],
    queryFn: async () => {
      const res = await apiFetch("/api/auth/runtime", { credentials: "include" });
      return res.json();
    },
  });

  const clerk = isClerkMode(runtime);
  const waitingRuntime = isLoading && !runtimeLoaded;

  return (
    <AuthShell>
      <h2 className="text-xl sm:text-2xl font-semibold text-metal-warm-white mb-2">
        Welcome Back
      </h2>
      <p className="text-metal-muted mb-6">Sign in to access your dashboard</p>

      {waitingRuntime && clerk ? (
        <Button disabled className="w-full min-h-[44px] lm-btn-outline">
          Loading sign-in…
        </Button>
      ) : clerk && !publishableKey ? (
        <Alert variant="destructive" data-testid="alert-clerk-missing-key">
          <AlertTitle>Sign-in unavailable</AlertTitle>
          <AlertDescription>
            Clerk publishable key is missing. Set{" "}
            <code className="text-xs">VITE_CLERK_PUBLISHABLE_KEY</code> before{" "}
            <code className="text-xs">npm run build</code>, and{" "}
            <code className="text-xs">CLERK_PUBLISHABLE_KEY</code> in server{" "}
            <code className="text-xs">.env</code>, then redeploy.
          </AlertDescription>
        </Alert>
      ) : clerk && clerkReady ? (
        <ClerkSignInPanel autoRedirect />
      ) : clerk ? (
        <Button disabled className="w-full min-h-[44px] lm-btn-outline">
          Preparing sign-in…
        </Button>
      ) : (
        <Button
          onClick={() => {
            window.location.href = resolveApiUrl("/api/login");
          }}
          className="w-full min-h-[44px] lm-btn-metal font-medium"
          data-testid="button-login-replit"
        >
          <i className="fab fa-codepen text-xl mr-2" />
          Login with Replit
        </Button>
      )}

      <div className="mt-6 pt-6 border-t lm-divider">
        <p className="text-sm text-metal-muted text-center">
          {clerk ? "Secure sign-in powered by Clerk" : "Replit Auth (legacy)"}
        </p>
      </div>

      {runtime?.devAuthBypass === true && (
        <div className="mt-4 p-3 lm-card-muted rounded-lg text-sm text-metal-muted">
          Local development: auth bypass is active (not shown in production).
        </div>
      )}
    </AuthShell>
  );
}
