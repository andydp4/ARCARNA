import { useEffect, useRef } from "react";
import { useClerk, useUser } from "@clerk/clerk-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CheckCircle2, LogOut } from "lucide-react";
import { AuthShell } from "@/components/AuthShell";
import { Button } from "@/components/ui/button";
import { apiFetch, resolveApiUrl, resolveAppPath } from "@/lib/appPaths";
import { isClerkMode, type AuthRuntime } from "@/lib/authConfig";
import { wipeAllOfflineData } from "@/lib/orgCacheWipe";

function SigningOutView() {
  return (
    <AuthShell subtitle="" title="Signing out…" showBrand={false}>
      <LogOut className="mx-auto h-10 w-10 text-metal-muted animate-pulse mb-4" aria-hidden />
      <p className="text-metal-muted text-center">Ending your session and clearing local data…</p>
    </AuthShell>
  );
}

export default function SignOutPage() {
  const { signOut } = useClerk();
  const { isLoaded, isSignedIn } = useUser();
  const started = useRef(false);
  const params = new URLSearchParams(window.location.search);
  const done = params.get("done") === "1";

  const { data: runtime } = useQuery<AuthRuntime>({
    queryKey: ["/api/auth/runtime"],
    queryFn: async () => {
      const res = await apiFetch("/api/auth/runtime", { credentials: "include" });
      return res.json();
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    if (done || started.current || !isLoaded || runtime === undefined) return;
    started.current = true;

    void (async () => {
      await wipeAllOfflineData();

      if (isClerkMode(runtime) && isSignedIn) {
        await signOut({ redirectUrl: resolveAppPath("/sign-out?done=1") });
        return;
      }

      if (!isClerkMode(runtime) && isSignedIn) {
        window.location.href = resolveApiUrl("/api/logout");
        return;
      }

      if (!isSignedIn) {
        window.history.replaceState({}, "", resolveAppPath("/sign-out?done=1"));
        window.location.reload();
      }
    })();
  }, [done, isLoaded, isSignedIn, runtime, signOut]);

  if (!done && (!isLoaded || runtime === undefined || isSignedIn)) {
    return <SigningOutView />;
  }

  return (
    <AuthShell subtitle="" title="Signed out" showBrand={false}>
      <CheckCircle2 className="mx-auto h-12 w-12 text-[hsl(158,64%,42%)] mb-4" aria-hidden />
      <p className="text-metal-muted text-center mb-6">
        You have been signed out of Midnight EPOS. Local offline data was cleared from this device.
      </p>
      <div className="flex flex-col gap-3">
        <Button className="w-full min-h-[44px] lm-btn-metal" asChild>
          <Link href="/sign-in">Sign in again</Link>
        </Button>
        <Button className="w-full min-h-[44px] lm-btn-outline" variant="outline" asChild>
          <a href="/">Back to Viger Cloud</a>
        </Button>
      </div>
    </AuthShell>
  );
}
