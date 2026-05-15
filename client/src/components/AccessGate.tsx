import { ReactNode, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";

const PUBLIC_PATHS = new Set([
  "/pending-approval",
  "/no-access",
  "/onboarding",
  "/setup-wizard",
  "/setup-blocked",
]);

const SETUP_ROLES = new Set(["SUPER_ADMIN", "ADMIN", "MANAGER"]);

function LoadingSpinner() {
  return <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />;
}

export function AccessGate({ children }: { children: ReactNode }) {
  const { user, isLoading, isAuthenticated, accessState, needsOnboarding, needsSetupWizard } = useAuth();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    if (PUBLIC_PATHS.has(location)) return;

    if (accessState === "pending") {
      setLocation("/pending-approval");
      return;
    }
    if (needsOnboarding || accessState === "no_org") {
      if (user?.role === "SUPER_ADMIN") {
        setLocation("/onboarding");
      } else {
        setLocation("/no-access");
      }
      return;
    }
    if (needsSetupWizard) {
      if (user?.role && SETUP_ROLES.has(user.role)) {
        setLocation("/setup-wizard");
      } else {
        setLocation("/setup-blocked");
      }
    }
  }, [
    isLoading,
    isAuthenticated,
    accessState,
    needsOnboarding,
    needsSetupWizard,
    location,
    setLocation,
    user?.role,
  ]);

  if (isLoading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  if (!isAuthenticated) return <>{children}</>;

  if (!PUBLIC_PATHS.has(location) && accessState === "pending") {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return <>{children}</>;
}
