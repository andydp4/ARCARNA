/**
 * ARC-T1-005 Delay Log — the one pure rule worth pinning down on its own.
 *
 * Split out of `server/services/reportsEngine.ts`'s `delayLog` (which does
 * the actual database reads) so `server/__tests__/reportCaptureLogic.test.ts`
 * — a `check`-job test with no database, run with no `DATABASE_URL` — can
 * import the REAL rule rather than a hand-copied mirror of it, without
 * dragging in `server/db.ts` (which throws at import time when
 * `DATABASE_URL` is unset) through `reportsEngine.ts`'s other, DB-backed
 * exports. `reportsEngine.ts` re-exports this symbol so existing callers of
 * `wasProactiveDelayComms` from there are unaffected.
 */

/**
 * Whether a delay warning reached the customer before the ORIGINAL promise
 * passed — compared against the original, not the revised, promise, because
 * comparing against the revised one would score every late warning as
 * proactive (it is trivially "before" a promise staff have already moved to
 * account for the very lateness being warned about).
 */
export function wasProactiveDelayComms(originalEta: Date | null, notifiedAt: Date | null): boolean {
  return Boolean(originalEta && notifiedAt && notifiedAt < originalEta);
}
