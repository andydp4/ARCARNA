import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth, type AuthUser } from "@/hooks/useAuth";

/**
 * Local copy of a seen marker. Kept for two reasons only: it hides the UI
 * instantly on this device while the server write is in flight, and it lets
 * the app degrade to the old per-device behaviour if the server cannot record
 * it. The account-level answer is `user.seenUi` from /api/auth/user.
 */
function readLocal(localKey: string): boolean {
  try {
    return localStorage.getItem(localKey) === "1";
  } catch {
    return false;
  }
}

function writeLocal(localKey: string) {
  try {
    localStorage.setItem(localKey, "1");
  } catch {
    // Private mode / blocked storage: the server marker still applies.
  }
}

/**
 * "Show this once per ACCOUNT": What's New, the Operations tour, and the v1.2
 * tutorials. These used to be remembered per browser only, so they came back
 * on every other device, in the installed app, in a private window, or after
 * site data was cleared.
 *
 * `key` is the account-level key (shared/uiSeen.ts); `legacyLocalKey` is the
 * localStorage flag the feature used before, so anyone who already dismissed
 * it on this device is not shown it again — and that dismissal is copied up
 * to their account once, so their other devices stop showing it too.
 *
 * `seen` is `undefined` until the signed-in user is known, so callers never
 * flash the UI open and shut while auth is loading.
 */
export function useSeenOnce(key: string, legacyLocalKey: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const syncedRef = useRef(false);

  const onServer = user?.seenUi?.includes(key) ?? false;
  const onDevice = readLocal(legacyLocalKey);
  const seen: boolean | undefined = user ? onServer || onDevice : undefined;

  const record = useCallback(async () => {
    try {
      await apiRequest("POST", "/api/me/seen", { keys: [key] });
    } catch {
      // Not fatal: the local flag still hides it on this device, and the next
      // mount on a device that has the flag retries the sync below.
    }
  }, [key]);

  // A dismissal made on this device before seen-state lived on the account:
  // copy it up once so every other device stops showing it too.
  useEffect(() => {
    if (!user || onServer || !onDevice || syncedRef.current) return;
    syncedRef.current = true;
    void record();
  }, [user, onServer, onDevice, record]);

  const markSeen = useCallback(() => {
    writeLocal(legacyLocalKey);
    queryClient.setQueryData<AuthUser | null>(["/api/auth/user"], (current) =>
      current && !current.seenUi?.includes(key)
        ? { ...current, seenUi: [...(current.seenUi ?? []), key] }
        : current,
    );
    void record();
  }, [key, legacyLocalKey, queryClient, record]);

  return { seen, markSeen };
}
