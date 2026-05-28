import { useClerk } from "@clerk/clerk-react";
import { useAuthConfig } from "@/components/AuthProviders";
import { appUrl } from "@/lib/authConfig";
import { wipeAllOfflineData, navigateToLogout } from "@/lib/orgCacheWipe";

/**
 * Sign out — clears offline caches, then Clerk session (when ClerkProvider is active).
 * Use in Layout and other screens rendered under ClerkProvider.
 */
export function useLogout() {
  const { clerkReady } = useAuthConfig();
  const { signOut } = useClerk();

  return async () => {
    await wipeAllOfflineData();
    if (clerkReady) {
      await signOut({ redirectUrl: appUrl("/") });
      return;
    }
    await navigateToLogout();
  };
}
