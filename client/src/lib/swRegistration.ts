/**
 * How loudly to report a failed service worker registration (v1.2.1 UI-14).
 *
 * Registration first probes sw.js with a HEAD request. A reload or navigation
 * while that probe is in flight aborts it, and the browser reports the abort
 * as `TypeError: Failed to fetch`; so does a probe made offline. Neither is a
 * fault: the page is going away, or the worker already registered on an
 * earlier visit keeps serving. Those are a warning. A failure of the
 * registration itself (a bad script, a scope the server refuses) is still an
 * error.
 */
export type SwFailureLevel = "error" | "warn";

export function swFailureLevel(
  error: unknown,
  ctx: { stage: "probe" | "register"; unloading: boolean; online: boolean },
): SwFailureLevel {
  if (ctx.unloading) return "warn";
  if (ctx.stage === "probe" && (error instanceof TypeError || !ctx.online)) return "warn";
  return "error";
}
