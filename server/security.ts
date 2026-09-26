import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { DEFAULT_JSON_BODY_LIMIT, IMPORT_JSON_BODY_LIMIT } from "@shared/importLimits";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

const rateLimitMessage = { message: "Too many requests, please try again later." };

/**
 * What every /api response may do if a browser ever renders it as a page
 * (v1.2.1 SEC-XSS-PREVIEW, SEC-CSP-HEADERS): nothing. No script of any kind,
 * no framing, no forms, no plugins. The few plain pages the API serves
 * (unsubscribed, payment received) use inline styles only, which stays
 * allowed. This is what stops reflected markup from ever running on the app
 * origin, whatever a handler sends.
 */
export const API_CONTENT_SECURITY_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: https:; " +
  "frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/**
 * The app's own pages, in production. Directives that cannot break the Vite
 * bundle or Clerk's sign-in: no plugins, no <base> hijack, no framing by
 * another site. A script-src allow-list is an owner decision (Clerk loads from
 * its own accounts domain), so it is not enforced here.
 */
export const PAGE_CONTENT_SECURITY_POLICY = "object-src 'none'; base-uri 'self'; frame-ancestors 'self'";

/** Helmet + other HTTP hardening. The full default CSP stays off so Vite bootstraps and Clerk sign-in work. */
export function applySecurityMiddleware(app: Express, isProduction: boolean): void {
  if (!isProduction) return;

  app.use(
    helmet({
      // Default CSP breaks Vite/React inline bootstraps on self-hosted builds.
      // Clerk auth loads from accounts.* subdomain. HSTS: helmet's default
      // (one year, includeSubDomains) is sent from here as well as nginx.
      contentSecurityPolicy: false,
    }),
  );
  app.use((_req: Request, res: Response, next: NextFunction) => {
    if (!res.getHeader("Content-Security-Policy")) {
      res.setHeader("Content-Security-Policy", PAGE_CONTENT_SECURITY_POLICY);
    }
    next();
  });
}

/**
 * Locks down every /api response in every environment: the strict CSP above
 * and nosniff, so a JSON or text body is never content-sniffed into a page.
 * Mounted on the app that owns /api (paths are relative to APP_BASE_PATH).
 */
export function apiResponseHardening(req: Request, res: Response, next: NextFunction): void {
  if (req.path.startsWith("/api/") || req.path === "/api") {
    res.setHeader("Content-Security-Policy", API_CONTENT_SECURITY_POLICY);
    res.setHeader("X-Content-Type-Options", "nosniff");
  }
  next();
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function hostOf(value: string): string | null {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Extra browser origins allowed to call the API, e.g. "https://shop.example.com". */
function allowedExtraOrigins(): Set<string> {
  return new Set(
    (process.env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((o) => o.trim().replace(/\/$/, "").toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Refuses a state-changing /api request that a browser sent from another site
 * (v1.2.1 SEC-CSRF-FORM). SameSite=Lax cookies stop a cross-site form, but
 * not one from a same-site sibling host (another *.viger.cloud site), and the
 * import routes take multipart forms, which need no CORS preflight.
 *
 * Judged on what browsers send and pages cannot forge: `Sec-Fetch-Site`
 * (anything but same-origin or a user-typed "none" is refused) and, for
 * browsers without it, `Origin` against the request's own host. A request
 * with neither header is not from a browser page (webhooks, curl, the v1 API
 * with its key) and is left to its own authentication.
 */
export function rejectCrossSiteMutations(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();
  if (!(req.path.startsWith("/api/") || req.path === "/api")) return next();

  const origin = req.get("origin");
  const originKey = origin?.trim().replace(/\/$/, "").toLowerCase();
  if (originKey && allowedExtraOrigins().has(originKey)) return next();

  const fetchSite = req.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    res.status(403).json({ message: "Cross-site requests are not allowed", code: "CROSS_SITE_REFUSED" });
    return;
  }
  if (origin && origin !== "null") {
    const host = (req.get("x-forwarded-host") ?? req.get("host") ?? "").split(",")[0].trim().toLowerCase();
    if (!host || hostOf(origin) !== host) {
      res.status(403).json({ message: "Cross-site requests are not allowed", code: "CROSS_SITE_REFUSED" });
      return;
    }
  } else if (origin === "null") {
    // An opaque origin (sandboxed frame, data: URL) is never the app.
    res.status(403).json({ message: "Cross-site requests are not allowed", code: "CROSS_SITE_REFUSED" });
    return;
  }
  next();
}

/** Bulk and import routes: the only ones allowed the large (25 MB) body limit. */
export function isLargeBodyApiPath(path: string): boolean {
  return isImportApiPath(path) || path === "/api/customers/bulk" || path === "/api/products/bulk";
}

/**
 * Session-state reads under /api/auth, as opposed to credential attempts.
 *
 * The auth limiter exists to throttle guessing: sign-in, bootstrap, approval.
 * Twenty a minute is right for those. It is wrong for the two endpoints that
 * only ever answer "who is this session, and how is auth configured" — the SPA
 * asks on every page load, and neither has anything to guess at. An
 * unauthenticated caller gets a 401 from /api/auth/user and learns nothing.
 *
 * Sizing a session read as if it were a password attempt is not a small
 * mistake here. A shop runs several tills behind one public IP, express-rate-
 * limit keys on that IP, and the client treats "could not ask" the same as
 * "not signed in" — so tripping this limit does not slow the app down, it
 * takes every route away and answers "this route does not exist" until the
 * window rolls over.
 *
 * These stay covered by the general /api limiter.
 */
export function isAuthStatePath(path: string): boolean {
  return path === "/api/auth/runtime" || path === "/api/auth/user";
}

/** POST/GET paths like /api/products/import and /api/customers/import/preview */
export function isImportApiPath(path: string): boolean {
  return /^\/api\/[^/]+\/import(\/|$)/.test(path);
}

/**
 * The Operations Centre board and its push stream, exempt from the shared-IP
 * limiter (brief finding G9 / "Live data"): every tablet on the counter
 * shares one shop IP, the board is read once per connect plus one
 * reconciliation poll a minute, and the stream is one long-lived GET per
 * tablet — none of that should ever compete with genuine API traffic for the
 * same 800-per-15-minutes budget. Kept to exactly these two paths, named
 * literally rather than by prefix, so nothing else can join the skip list by
 * accident (brief, "Security" row: "the limiter skip list contains only the
 * board"). The one later addition, the usage batches (isUsageEventsPath),
 * is also named literally and has its own per-device and per-shop limits.
 */
export function isOpsBoardOrStreamPath(path: string): boolean {
  return path === "/api/orders/board" || path === "/api/orders/board/stream";
}

/**
 * The usage record's batches (v1.2 Phase 8B). Every till shares the shop's
 * one address, so this shared-IP budget would be one bucket for all of them;
 * the route has its own limits instead: per device (DEVICE_EVENTS_PER_HOUR)
 * and, because the device key is the till's own word, per shop
 * (ORG_EVENTS_PER_HOUR). Named literally, like the board.
 */
export function isUsageEventsPath(path: string): boolean {
  return path === "/api/usage/events";
}

export function createApiRateLimiters(isProduction: boolean) {
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isProduction ? 800 : 50_000,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) =>
      req.path === "/api/health" ||
      req.path === "/api/auth/runtime" ||
      isOpsBoardOrStreamPath(req.path) ||
      isUsageEventsPath(req.path),
    message: rateLimitMessage,
  });

  const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => isAuthStatePath(req.path),
    message: rateLimitMessage,
  });

  const importLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: rateLimitMessage,
  });

  return { apiLimiter, authLimiter, importLimiter };
}

/** Tiered limits: auth attempts (20/min) and import (5/min) before global /api (800/15min prod). */
export function mountTieredApiRateLimits(router: Express, isProduction: boolean): void {
  const { apiLimiter, authLimiter, importLimiter } = createApiRateLimiters(isProduction);

  router.use((req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith("/api/auth")) return next();
    return authLimiter(req, res, next);
  });

  router.use((req: Request, res: Response, next: NextFunction) => {
    if (!isImportApiPath(req.path)) return next();
    return importLimiter(req, res, next);
  });

  router.use((req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith("/api")) return next();
    return apiLimiter(req, res, next);
  });
}

/**
 * The app's only body parser: JSON, with the large import limit on the import
 * and bulk routes alone (v1.2.1 SEC-CSRF-FORM, SEC-BODY-PREAUTH). Nothing
 * inbound is form-encoded, so no urlencoded parser: that let a plain HTML form
 * on another site post to the API. `basePath` is APP_BASE_PATH, since this is
 * mounted above the app that owns /api.
 */
export function createJsonBodyParser(basePath: string) {
  const captureRawBody = (req: any, _res: unknown, buf: Buffer) => {
    req.rawBody = buf;
  };
  const largeJson = express.json({ limit: IMPORT_JSON_BODY_LIMIT, verify: captureRawBody });
  const defaultJson = express.json({ limit: DEFAULT_JSON_BODY_LIMIT, verify: captureRawBody });
  return (req: Request, res: Response, next: NextFunction) => {
    const apiPath = basePath && req.path.startsWith(`${basePath}/`) ? req.path.slice(basePath.length) : req.path;
    return (isLargeBodyApiPath(apiPath) ? largeJson : defaultJson)(req, res, next);
  };
}
