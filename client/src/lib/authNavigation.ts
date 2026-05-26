import type { AuthUser } from "@/hooks/useAuth";

const SETUP_ROLES = new Set(["SUPER_ADMIN", "ADMIN", "MANAGER"]);

/** First protected route after sign-in (home dashboard is `/`). */
export function resolveAppEntryPath(user: AuthUser | null): string {
  if (!user) return "/";
  if (user.accessState === "pending" || user.isPending) return "/pending-approval";
  if (user.needsOnboarding || user.accessState === "no_org") {
    return user.role === "SUPER_ADMIN" ? "/onboarding" : "/no-access";
  }
  if (user.needsSetupWizard) {
    return user.role && SETUP_ROLES.has(user.role) ? "/setup-wizard" : "/setup-blocked";
  }
  return "/";
}

export function navigateToAppEntry(user: AuthUser | null, source = "auth"): boolean {
  const target = resolveAppEntryPath(user);
  const current = `${window.location.pathname}${window.location.search}`;

  if (user && current === target) {
    console.info(`[${source}] Already on app entry route: ${target}`);
    return true;
  }

  try {
    console.info(`[${source}] Navigating to app entry: ${target}`);
    window.location.assign(target);
    return true;
  } catch (err) {
    console.error(`[${source}] Navigation failed`, err);
    return false;
  }
}
