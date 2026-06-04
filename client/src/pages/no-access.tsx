import { ShieldOff, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { navigateToLogout } from "@/lib/orgCacheWipe";
import { AuthShell } from "@/components/AuthShell";

export default function NoAccess() {
  const { user } = useAuth();

  return (
    <AuthShell title="No organization access" subtitle={user?.email || undefined} showBrand={false}>
      <ShieldOff className="mx-auto h-12 w-12 text-[hsl(0,72%,51%)] mb-4" aria-hidden />
      <p className="text-sm text-center text-metal-muted mb-6">
        Your account is approved but not assigned to an organization yet. Contact a platform administrator
        to assign you to an organization and role.
      </p>
      <Button variant="outline" className="w-full min-h-[44px] lm-btn-outline" onClick={() => navigateToLogout()} data-testid="button-logout-no-access">
        <LogOut className="mr-2 h-4 w-4" />
        Sign out
      </Button>
    </AuthShell>
  );
}
