import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAuthConfig } from "@/components/AuthProviders";
import { ClerkSignInPanel } from "@/components/ClerkSignInPanel";
import { type AuthRuntime, isClerkMode } from "@/lib/authConfig";

export default function SignInPage() {
  const { clerkReady, publishableKey } = useAuthConfig();
  const { data: runtime } = useQuery<AuthRuntime>({
    queryKey: ["/api/auth/runtime"],
    queryFn: async () => {
      const res = await fetch("/api/auth/runtime", { credentials: "include" });
      return res.json();
    },
  });

  if (!isClerkMode(runtime)) {
    window.location.href = "/api/login";
    return null;
  }

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
          <Button className="mt-4 w-full" variant="outline" onClick={() => { window.location.href = "/"; }}>
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
      <div className="w-full max-w-md rounded-lg bg-card p-6 shadow-2xl">
        <ClerkSignInPanel routing="path" />
      </div>
    </div>
  );
}
