import type { Express, Request, Response, NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

const rateLimitMessage = { message: "Too many requests, please try again later." };

/** Helmet + other HTTP hardening. CSP stays off so Vite bootstraps and Clerk sign-in work. */
export function applySecurityMiddleware(app: Express, isProduction: boolean): void {
  if (!isProduction) return;

  app.use(
    helmet({
      // Default CSP breaks Vite/React inline bootstraps on self-hosted builds.
      // Clerk auth loads from accounts.* subdomain; edge HSTS is set in nginx (see deploy docs).
      contentSecurityPolicy: false,
    }),
  );
}

/** POST/GET paths like /api/products/import and /api/customers/import/preview */
export function isImportApiPath(path: string): boolean {
  return /^\/api\/[^/]+\/import(\/|$)/.test(path);
}

export function createApiRateLimiters(isProduction: boolean) {
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isProduction ? 800 : 50_000,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) =>
      req.path === "/api/health" || req.path === "/api/auth/runtime",
    message: rateLimitMessage,
  });

  const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === "/api/auth/runtime",
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

/** Tiered limits: auth (20/min) and import (5/min) before global /api (800/15min prod). */
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
