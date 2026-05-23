import { useQuery } from "@tanstack/react-query";
import { SignInButton, SignedIn, SignedOut } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useLocation } from "wouter";

type AuthRuntime = {
  authProvider?: "clerk" | "replit";
  devAuthBypass?: boolean;
};

/** Production default is Clerk; Replit login only when server reports AUTH_PROVIDER=replit. */
function resolveAuthProvider(runtime: AuthRuntime | undefined, isLoading: boolean): "clerk" | "replit" | "loading" {
  if (isLoading && !runtime) return "loading";
  if (runtime?.authProvider === "replit") return "replit";
  const viteProvider = import.meta.env.VITE_AUTH_PROVIDER as string | undefined;
  if (!runtime && viteProvider === "replit") return "replit";
  return "clerk";
}

export default function Landing() {
  const [, setLocation] = useLocation();
  const { data: runtime, isLoading } = useQuery<AuthRuntime>({
    queryKey: ["/api/auth/runtime"],
    queryFn: async () => {
      const res = await fetch("/api/auth/runtime", { credentials: "include" });
      return res.json();
    },
  });

  const provider = resolveAuthProvider(runtime, isLoading);
  const showDevNotice = runtime?.devAuthBypass === true;

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

            {provider === "loading" ? (
              <Button disabled className="w-full min-h-[44px]">
                Loading sign-in…
              </Button>
            ) : provider === "clerk" ? (
              <>
                <SignedOut>
                  <SignInButton mode="redirect" forceRedirectUrl="/">
                    <Button
                      className="w-full min-h-[44px] bg-secondary hover:bg-blue-600 text-white font-medium py-3 px-4 shadow-lg hover:shadow-xl"
                      data-testid="button-login"
                    >
                      Sign in
                    </Button>
                  </SignInButton>
                </SignedOut>
                <SignedIn>
                  <Button
                    className="w-full min-h-[44px]"
                    onClick={() => setLocation("/")}
                    data-testid="button-continue"
                  >
                    Continue to dashboard
                  </Button>
                </SignedIn>
              </>
            ) : (
              <Button
                onClick={() => { window.location.href = "/api/login"; }}
                className="w-full min-h-[44px] bg-secondary hover:bg-blue-600 text-white font-medium py-3 px-4 flex items-center justify-center gap-3 shadow-lg hover:shadow-xl"
                data-testid="button-login-replit-dev"
              >
                <i className="fab fa-codepen text-xl"></i>
                <span>Login with Replit (dev rollback)</span>
              </Button>
            )}

            <div className="mt-6 pt-6 border-t border-border">
              <p className="text-sm text-muted-foreground text-center">
                {provider === "clerk"
                  ? "Secure sign-in powered by Clerk"
                  : "Replit Auth (development rollback only)"}
              </p>
            </div>

            {showDevNotice && (
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
