import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuthConfig } from "@/components/AuthProviders";
import { ClerkSignInPanel } from "@/components/ClerkSignInPanel";
import {
  type AuthRuntime,
  isClerkMode,
} from "@/lib/authConfig";

export default function Landing() {
  const { clerkReady, publishableKey, runtimeLoaded } = useAuthConfig();
  const { data: runtime, isLoading } = useQuery<AuthRuntime>({
    queryKey: ["/api/auth/runtime"],
    queryFn: async () => {
      const res = await fetch("/api/auth/runtime", { credentials: "include" });
      return res.json();
    },
  });

  const clerk = isClerkMode(runtime);
  const waitingRuntime = isLoading && !runtimeLoaded;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary via-slate-800 to-slate-900 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-4 rounded-2xl shadow-lg ring-2 ring-white/10">
            <img
              src="/logo.png"
              alt="Midnight EPOS"
              width={96}
              height={96}
              className="h-24 w-24 rounded-2xl object-contain"
            />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">Midnight EPOS</h1>
          <p className="text-slate-300 text-base sm:text-lg">
            Enterprise Point of Sale System
          </p>
        </div>

        <Card className="shadow-2xl border-slate-700">
          <CardContent className="p-6 sm:p-8">
            <h2 className="text-xl sm:text-2xl font-semibold text-foreground mb-2">
              Welcome Back
            </h2>
            <p className="text-muted-foreground mb-6">
              Sign in to access your dashboard
            </p>

            {waitingRuntime && clerk ? (
              <Button disabled className="w-full min-h-[44px]">
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
              <ClerkSignInPanel routing="hash" />
            ) : clerk ? (
              <Button disabled className="w-full min-h-[44px]">
                Preparing sign-in…
              </Button>
            ) : (
              <Button
                onClick={() => {
                  window.location.href = "/api/login";
                }}
                className="w-full min-h-[44px] bg-secondary hover:bg-blue-600 text-white font-medium py-3 px-4 flex items-center justify-center gap-3 shadow-lg hover:shadow-xl"
                data-testid="button-login-replit"
              >
                <i className="fab fa-codepen text-xl"></i>
                <span>Login with Replit</span>
              </Button>
            )}

            <div className="mt-6 pt-6 border-t border-border">
              <p className="text-sm text-muted-foreground text-center">
                {clerk
                  ? "Secure sign-in powered by Clerk"
                  : "Replit Auth (legacy)"}
              </p>
            </div>

            {runtime?.devAuthBypass === true && (
              <div className="mt-4 p-3 bg-accent/10 border border-accent/20 rounded-lg">
                <div className="flex items-start gap-2">
                  <i className="fas fa-info-circle text-accent mt-0.5"></i>
                  <div className="text-sm text-foreground">
                    Local development: auth bypass is active (not shown in production).
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="text-center mt-8 text-slate-400 text-sm">
          <p>© 2024 Midnight EPOS. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}
