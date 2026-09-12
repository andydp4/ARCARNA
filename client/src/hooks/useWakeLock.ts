import { useEffect } from "react";

/**
 * Keeps the counter tablet's screen awake while the board is open.
 *
 * The board is an information radiator: it is looked AT far more often than it
 * is touched, so the device's own idle timer is exactly wrong for it — the one
 * screen in the building that must always be readable is the one nobody keeps
 * tapping. `navigator.wakeLock` is the supported way to say so (brief, "Alerts
 * & notifications" → Delivery: "navigator.wakeLock.request('screen') while
 * mounted ... re-requested on visible").
 *
 * Two realities shape the implementation:
 *   - The lock is dropped by the browser whenever the page is hidden (tab
 *     switch, screen off), and is NOT restored automatically, so it is
 *     re-requested on every `visibilitychange` back to visible.
 *   - `request()` rejects on iPadOS below 16.4, in insecure contexts, and
 *     whenever the user agent simply declines. That is not an error worth
 *     showing anybody: the board still works, the screen just dims as usual.
 */
export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const wakeLock = (navigator as Navigator & { wakeLock?: WakeLockAPI }).wakeLock;
    if (!wakeLock) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        sentinel = await wakeLock.request("screen");
      } catch {
        // Declined, unsupported, or not a secure context — the board is still
        // perfectly usable, it just does not hold the screen on.
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void sentinel?.release().catch(() => {
        /* already released by the browser when the page was hidden */
      });
      sentinel = null;
    };
  }, [enabled]);
}

/** Minimal shapes for the Screen Wake Lock API, which TS's DOM lib may predate. */
interface WakeLockSentinelLike {
  release(): Promise<void>;
}

interface WakeLockAPI {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}
