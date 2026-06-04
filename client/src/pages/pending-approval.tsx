import { useQuery } from "@tanstack/react-query";
import { apiFetch, resolveAppPath } from "@/lib/appPaths";
import { Button } from "@/components/ui/button";
import { Clock, LogOut, XCircle, RefreshCw } from "lucide-react";
import { navigateToLogout } from "@/lib/orgCacheWipe";
import { AuthShell } from "@/components/AuthShell";

interface ApprovalStatus {
  authenticated: boolean;
  isAllowed: boolean;
  isPending: boolean;
  isRejected: boolean;
  name: string;
  email: string;
}

export default function PendingApproval() {
  const { data: status, isLoading, refetch } = useQuery<ApprovalStatus>({
    queryKey: ["/api/auth/approval-status"],
    queryFn: async () => {
      const response = await apiFetch("/api/auth/approval-status", { credentials: "include" });
      return response.json();
    },
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <AuthShell title="Checking access…" subtitle="">
        <div className="flex justify-center py-6">
          <div className="h-10 w-10 rounded-full border-2 border-[hsl(210,15%,78%/0.2)] border-t-[hsl(210,10%,78%)] animate-spin" />
        </div>
      </AuthShell>
    );
  }

  if (status?.isAllowed) {
    window.location.href = resolveAppPath("/");
    return null;
  }

  const rejected = status?.isRejected;

  return (
    <AuthShell
      title={rejected ? "Access denied" : "Access pending"}
      subtitle={status?.email || "Awaiting administrator approval"}
      showBrand={false}
    >
      <div className="text-center mb-6">
        {rejected ? (
          <XCircle className="mx-auto h-12 w-12 text-[hsl(0,72%,51%)] mb-3" aria-hidden />
        ) : (
          <Clock className="mx-auto h-12 w-12 text-[hsl(38,92%,50%)] mb-3 animate-pulse" aria-hidden />
        )}
        <p className="text-lg font-medium text-metal-warm-white">Hello, {status?.name || "User"}</p>
      </div>

      <div
        className={
          rejected
            ? "lm-card-muted rounded-lg p-4 mb-6 text-sm text-center text-[hsl(0,72%,65%)]"
            : "lm-card-muted rounded-lg p-4 mb-6 text-sm text-center text-[hsl(38,92%,60%)]"
        }
      >
        {rejected
          ? "The administrator denied your access request. Contact them if you believe this is an error."
          : "Your request is waiting for review. This page refreshes automatically every 30 seconds."}
      </div>

      <div className="flex flex-col gap-3">
        <Button onClick={() => refetch()} variant="outline" className="w-full min-h-[44px] lm-btn-outline" data-testid="button-refresh-status">
          <RefreshCw className="mr-2 h-4 w-4" />
          Check status
        </Button>
        <Button onClick={() => navigateToLogout()} variant="ghost" className="w-full min-h-[44px] text-metal-muted" data-testid="button-logout">
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </Button>
      </div>
    </AuthShell>
  );
}
