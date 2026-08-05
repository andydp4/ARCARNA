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
  return path === "/api" || path.startsWith("/api/");
}

export function sendApiNotFound(res: Response, method: string, path: string): void {
  res.status(404).json({
    code: "NOT_FOUND",
    message: `Cannot ${method} ${path}`,
  });
}
