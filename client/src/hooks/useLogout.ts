import { navigateToLogout } from "@/lib/orgCacheWipe";

/**
 * Sign out. Always through the /sign-out page, which refuses while the till
 * still holds sales that have not reached arcarna (v1.2 Phase 1A) and only
 * then clears offline data and ends the Clerk or legacy session.
 */
export function useLogout() {
  return async () => {
    await navigateToLogout();
  };
}
