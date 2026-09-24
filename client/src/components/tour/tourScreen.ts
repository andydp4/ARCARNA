/**
 * One spotlight tour on screen at a time (v1.2 Phase 9). A page can now have
 * a Centre tour and a feature tour, and both auto-start on first visit; the
 * callout only reaches the DOM a beat after a tour opens, so checking for an
 * open dialog alone could let two start together. Whichever tour opens first
 * holds the screen until it finishes or unmounts; the other waits its turn.
 */

let holder: string | null = null;

/** Whether the tour named `id` may take the screen now. */
export function tourScreenFree(id: string): boolean {
  return holder === null || holder === id;
}

/** Take the screen. False when another tour already has it. */
export function claimTourScreen(id: string): boolean {
  if (!tourScreenFree(id)) return false;
  holder = id;
  return true;
}

/** Give the screen back (a no-op unless `id` holds it). */
export function releaseTourScreen(id: string): void {
  if (holder === id) holder = null;
}

/** Tests only. */
export function resetTourScreen(): void {
  holder = null;
}
