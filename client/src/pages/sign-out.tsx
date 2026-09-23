import { useCallback, useEffect, useRef, useState } from "react";
import { useClerk, useUser } from "@clerk/clerk-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, CheckCircle2, LogOut } from "lucide-react";
import { AuthShell } from "@/components/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, resolveApiUrl, resolveAppPath } from "@/lib/appPaths";
import { isClerkMode, type AuthRuntime } from "@/lib/authConfig";
import { wipeAllOfflineData } from "@/lib/orgCacheWipe";
import { countUnsentSalesOnDevice } from "@/lib/offline-storage";
import { syncService } from "@/lib/sync-service";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { isAtLeast } from "@shared/accessPolicy";
import { BRAND_PRODUCT_NAME } from "@shared/brand";

function SigningOutView() {
  return (
    <AuthShell subtitle="" title="Signing out…" showBrand={false}>
      <LogOut className="mx-auto h-10 w-10 text-metal-muted animate-pulse mb-4" aria-hidden />
      <p className="text-metal-muted text-center">Ending your session and clearing local data…</p>
    </AuthShell>
  );
}

/**
 * Signing out deletes everything the till kept offline, so it waits until
 * every sale has reached arcarna (v1.2 Phase 1A). A manager may override: the
 * sales still here are handed to Needs attention first, and the override is
 * logged before the till signs out.
 */
function UnsentSalesView({ count, onClear }: { count: number; onClear: () => void }) {
  const { user } = useAuth();
  const isManager = isAtLeast(user?.role, "MANAGER");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [left, setLeft] = useState(count);

  const sendNow = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await syncService.syncOnline({ force: true });
      const remaining = await countUnsentSalesOnDevice();
      setLeft(remaining);
      if (remaining === 0) onClear();
      else setMessage(navigator.onLine ? "Some sales still did not go. Try again in a moment." : "Still no connection.");
    } catch {
      setMessage("Could not check the till's saved sales.");
    } finally {
      setBusy(false);
    }
  };

  const override = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const handed = await syncService.handOverForSignOut();
      await apiRequest("POST", "/api/sale-issues/sign-out-override", {
        waiting: handed.waiting,
        failed: handed.failed,
        reason: reason.trim(),
        references: handed.references,
      });
      onClear();
    } catch (error) {
      setMessage((error as Error).message || "The override could not be logged, so the till stays signed in.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell subtitle="" title="Sales not sent yet" showBrand={false}>
      <AlertTriangle className="mx-auto mb-4 h-10 w-10 text-[hsl(38,92%,50%)]" aria-hidden />
      <p className="mb-4 text-center text-metal-muted" data-testid="sign-out-blocked">
        {left} sale{left === 1 ? " has" : "s have"} not reached {BRAND_PRODUCT_NAME} yet. Signing out now would
        delete {left === 1 ? "it" : "them"} from this till, so this till stays signed in until{" "}
        {left === 1 ? "it is" : "they are"} sent.
      </p>
      <div className="flex flex-col gap-3">
        <Button className="w-full min-h-[44px] lm-btn-metal" onClick={sendNow} disabled={busy} data-testid="sign-out-send-now">
          Try sending now
        </Button>
        <Button className="w-full min-h-[44px] lm-btn-outline" variant="outline" asChild>
          <Link href="/" data-testid="sign-out-stay">Stay signed in</Link>
        </Button>
        {isManager ? (
          <div className="mt-2 space-y-2 rounded-md border border-border p-3 text-left">
            <Label htmlFor="sign-out-override-reason">Manager: sign out anyway</Label>
            <p className="text-xs text-metal-muted">
              The sales are handed to Needs attention first, so none is lost, and this is logged under your name.
              Needs a connection.
            </p>
            <Input
              id="sign-out-override-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why this till is being signed out now"
              data-testid="sign-out-override-reason"
            />
            <Button
              variant="destructive"
              className="w-full min-h-[44px]"
              disabled={busy || reason.trim().length < 3}
              onClick={override}
              data-testid="sign-out-override"
            >
              Hand the sales over and sign out
            </Button>
          </div>
        ) : (
          <p className="text-xs text-metal-muted">
            If the connection stays down, leave this till signed in; the sales go by themselves once it is back.
          </p>
        )}
        {message && (
          <p className="text-sm text-destructive" role="alert" data-testid="sign-out-message">
            {message}
          </p>
        )}
      </div>
    </AuthShell>
  );
}

export default function SignOutPage() {
  const { signOut } = useClerk();
  const { isLoaded, isSignedIn } = useUser();
  const started = useRef(false);
  const params = new URLSearchParams(window.location.search);
  const done = params.get("done") === "1";
  // "checking" until the till's saved sales have been counted; sign-out
  // proceeds only on "clear".
  const [guard, setGuard] = useState<"checking" | "clear" | { unsent: number }>(done ? "clear" : "checking");

  const { data: runtime } = useQuery<AuthRuntime>({
    queryKey: ["/api/auth/runtime"],
    queryFn: async () => {
      const res = await apiFetch("/api/auth/runtime", { credentials: "include" });
      return res.json();
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    if (done) return;
    let cancelled = false;
    countUnsentSalesOnDevice()
      .then((n) => {
        if (!cancelled) setGuard(n > 0 ? { unsent: n } : "clear");
      })
      // Could not read the till's storage: fail safe, as if a sale were there.
      .catch(() => {
        if (!cancelled) setGuard({ unsent: 1 });
      });
    return () => {
      cancelled = true;
    };
  }, [done]);

  const clear = useCallback(() => setGuard("clear"), []);

  useEffect(() => {
    if (done || started.current || guard !== "clear" || !isLoaded || runtime === undefined) return;
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
  }, [done, guard, isLoaded, isSignedIn, runtime, signOut]);

  if (!done && typeof guard === "object") {
    return <UnsentSalesView count={guard.unsent} onClear={clear} />;
  }

  if (!done && (guard === "checking" || !isLoaded || runtime === undefined || isSignedIn)) {
    return <SigningOutView />;
  }

  return (
    <AuthShell subtitle="" title="Signed out" showBrand={false}>
      <CheckCircle2 className="mx-auto h-12 w-12 text-[hsl(158,64%,42%)] mb-4" aria-hidden />
      <p className="text-metal-muted text-center mb-6">
        You have been signed out of {BRAND_PRODUCT_NAME}. Local offline data was cleared from this device.
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
