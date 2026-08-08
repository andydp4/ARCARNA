import type { Response } from "express";

/**
 * Guard for the SPA fallback.
 *
 * Both the dev (vite.ts) and production (static.ts) fallbacks answer anything
 * unmatched with index.html and a 200, so that an unknown URL still boots the
 * client router. That is right for page routes and wrong for /api: a request
 * that reaches the fallback matched no route at all — a typo, a wrong method, or
 * an endpoint that was removed — and answering 200 text/html makes a failed call
 * indistinguishable from a successful one. The caller's `res.json()` then throws
 * on "<!doctype html>" somewhere unrelated, instead of on a status code anyone
 * can read in the network tab.
 *
 * The journeys suite recorded this as a known defect (5.4, `test.fail`), having
 * found four live examples including PATCH /api/rules/:id, which is registered as
 * PUT — a wrong-method call that reported success.
 *
 * Note this is genuinely a 404 and not an auth boundary: real routes sit behind
 * `isAuthenticated` and never reach here, so nothing about tenant data changes.
 * The only thing that changes is that a miss now looks like a miss.
 */
export function isUnmatchedApiPath(path: string): boolean {
  if (path === "/api" || path.startsWith("/api/")) return true;

  // Also catch a BASE-PREFIXED api path, e.g. "/arcarna/api/health".
  //
  // serveStatic/setupVite mount on eposApp, which Express mounts at
  // APP_BASE_PATH — so req.path is normally already base-stripped and the check
  // above is enough. It stops being enough when the caller's idea of the base
  // path disagrees with the app's: the request then never matches a route,
  // arrives here still carrying the prefix, and would be answered with the SPA
  // shell and a 200.
  //
  // That is not hypothetical. scripts/deploy-production.sh curls
  // "${APP_BASE_PATH:-/arcarna}/api/health" without sourcing .env, so its base
  // path is whatever bash defaults to rather than what PM2 loaded into the app.
  // A production deploy printed the entire index.html under "=== health check
  // ==="  and then declared "OK: App is responding."
  //
  // A mismatch here should be loud. 404 JSON makes it obvious; HTML with a 200
  // is what let a vacuous health check pass every deploy.
  const segments = path.split("/").filter(Boolean);
  return segments.length >= 2 && segments[1] === "api";
}

export function sendApiNotFound(res: Response, method: string, path: string): void {
  res.status(404).json({
    code: "NOT_FOUND",
    message: `Cannot ${method} ${path}`,
  });
}
