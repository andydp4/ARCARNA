import type { Express } from "express";
import { withAppBase } from "@shared/appPaths";
import { LEGACY_APP_BASE_PATH } from "@shared/brand";

const LEGACY_EPOS_SEGMENTS = [
  "pos",
  "orders",
  "inventory",
  "products",
  "insights",
  "reports",
  "analytics",
  "locations",
  "customers",
  "loyalty",
  "promotions",
  "expenses",
  "expense-reports",
  "invoices",
  "settings",
  "tick-list",
  "user-access",
  "worker-logs",
  "rules",
  "scheduled-reports",
  "purchase-drafts",
  "sign-in",
  "pending-approval",
  "onboarding",
  "onboarding/wizard",
  "no-access",
  "setup-wizard",
  "setup-blocked",
] as const;

/** Redirect old root URLs (bookmarks) to {basePath}/... */
export function registerLegacyEposRedirects(app: Express, basePath: string): void {
  if (!basePath) return;

  for (const segment of LEGACY_EPOS_SEGMENTS) {
    app.get(`/${segment}`, (req, res) => {
      const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
      res.redirect(301, `${withAppBase(basePath, `/${segment}`)}${query}`);
    });
  }
}

/** 301 from previous app mount (/midnight) to current base path (/arcarna). */
export function registerLegacyBasePathRedirects(
  app: Express,
  legacyPath: string,
  basePath: string,
): void {
  if (!legacyPath || !basePath || legacyPath === basePath) return;

  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const path = req.path;
    if (path !== legacyPath && !path.startsWith(`${legacyPath}/`)) return next();
    const suffix = path.slice(legacyPath.length) || "/";
    const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    res.redirect(301, `${basePath}${suffix}${query}`);
  });
}

/** Register /midnight → /arcarna when base path is /arcarna. */
export function registerDefaultLegacyBasePathRedirects(app: Express, basePath: string): void {
  registerLegacyBasePathRedirects(app, LEGACY_APP_BASE_PATH, basePath);
}
