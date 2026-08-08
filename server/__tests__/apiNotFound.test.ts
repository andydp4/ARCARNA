import { describe, it, expect } from "vitest";
import { isUnmatchedApiPath } from "../apiNotFound";

/**
 * The SPA fallback answers unmatched requests with index.html and a 200 so the
 * client router boots on any URL. This predicate is what stops it doing that for
 * /api, where a 200 of HTML makes a failed call look like a successful one.
 *
 * The base-prefixed cases are not theoretical. serveStatic mounts on eposApp, so
 * req.path is normally base-stripped — but when a caller's base path disagrees
 * with the app's, the request matches no route and arrives here still carrying
 * the prefix. A production deploy printed an entire index.html under
 * "=== health check ===" and then declared "OK: App is responding."
 */
describe("isUnmatchedApiPath", () => {
  it.each([
    ["/api/health", "bare api path"],
    ["/api", "bare /api with no trailing segment"],
    ["/arcarna/api/health", "base-prefixed — the deploy health-check case"],
    ["/midnight/api/orders", "legacy base prefix, still an API call"],
  ])("treats %s as an API path (%s)", (path) => {
    expect(isUnmatchedApiPath(path)).toBe(true);
  });

  it.each([
    ["/", "root"],
    ["/products", "top-level page route"],
    ["/open-orders/123", "nested page route"],
    ["/arcarna/products", "base-prefixed page route"],
    // Guards the segment comparison against a substring match: a page whose name
    // merely starts with "api" must still render, not 404 as JSON.
    ["/apiary", "page route beginning with 'api'"],
    ["/arcarna/apiary", "base-prefixed page route beginning with 'api'"],
  ])("leaves %s to the SPA fallback (%s)", (path) => {
    expect(isUnmatchedApiPath(path)).toBe(false);
  });
});
