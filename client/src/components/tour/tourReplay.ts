/**
 * "Replay tour" asked for before the tour that answers it is on screen: the
 * Operations Centre's Replay tour from Credit List navigates to the lazily
 * loaded board, whose tour mounts (and whose steps render) a beat later. The
 * request is parked here and taken up when that tour mounts, instead of being
 * fired into a window event nobody is listening to yet.
 */

/** Long enough for a lazy page and its data to arrive; short enough that a stale request never surprises anyone later. */
export const PENDING_REPLAY_TTL_MS = 15_000;

const pending = new Map<string, number>();

/** Ask the tour listening on `startEvent` to replay now, or as soon as it mounts. */
export function requestTourReplay(startEvent: string, now: number = Date.now()): void {
  pending.set(startEvent, now);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(startEvent));
}

/** Whether a replay is still waiting for this tour. Expired requests are dropped. */
export function hasPendingReplay(startEvent: string, now: number = Date.now()): boolean {
  const at = pending.get(startEvent);
  if (at === undefined) return false;
  if (now - at > PENDING_REPLAY_TTL_MS) {
    pending.delete(startEvent);
    return false;
  }
  return true;
}

/** The replay was shown (or given up on). */
export function clearPendingReplay(startEvent: string): void {
  pending.delete(startEvent);
}
