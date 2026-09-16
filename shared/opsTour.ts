import { APP_VERSION } from "./version";

/**
 * Version gate for `OpsTour`'s "already seen this once" localStorage flag —
 * same contract as `shared/whatsNew.ts`'s `LATEST_WHATS_NEW_VERSION`, kept as
 * its own constant (not reused from that file) so the tour and the release
 * notes can be bumped independently of one another.
 */
export const LATEST_OPS_TOUR_VERSION = APP_VERSION;

export function opsTourSeenKey(version: string): string {
  return `opsTour:seen:${version}`;
}
