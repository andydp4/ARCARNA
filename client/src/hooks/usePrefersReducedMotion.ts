import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function readPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia(QUERY).matches;
  } catch {
    return false;
  }
}

/**
 * Whether the viewer has asked for reduced motion, read synchronously on
 * first render (not discovered a tick later in an effect) so a pulsing card
 * or an entrance animation never paints its motion for one frame before
 * settling down to a static state — the flash itself would be the thing
 * `prefers-reduced-motion` exists to prevent.
 *
 * Mirrors the inline `matchMedia` pattern already used for the Control
 * Centre backdrop (client/src/components/dashboard/ControlCentreBackdrop.tsx)
 * as a shared hook, for the Operations Centre's pulse, its "new card" flash
 * and any other motion the board adds.
 */
export function usePrefersReducedMotion(): boolean {
  const [prefersReduced, setPrefersReduced] = useState<boolean>(readPrefersReducedMotion);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(QUERY);
    const onChange = (event: MediaQueryListEvent) => setPrefersReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return prefersReduced;
}
