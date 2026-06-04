import { Clock, LogOut } from "lucide-react";
import { navigateToLogout } from "@/lib/orgCacheWipe";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/AuthShell";

export default function SetupBlocked() {
  return (
    <AuthShell title="Setup in progress" subtitle="Organization configuration" showBrand={false}>
      <Clock className="mx-auto h-12 w-12 text-[hsl(38,92%,50%)] mb-4" aria-hidden />
      <p className="text-sm text-center text-metal-muted mb-6">
        An administrator is completing organization setup. You can sign in again once setup is finished.
      </p>
      <Button variant="outline" className="w-full min-h-[44px] lm-btn-outline" onClick={() => navigateToLogout()}>
        <LogOut className="mr-2 h-4 w-4" />
        Sign out
      </Button>
    </AuthShell>
  );
}
