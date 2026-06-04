import type { Express } from "express";
import { withAppBase } from "@shared/appPaths";

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

/** Redirect old root URLs (bookmarks) to /midnight/... */
export function registerLegacyEposRedirects(app: Express, basePath: string): void {
  if (!basePath) return;

  for (const segment of LEGACY_EPOS_SEGMENTS) {
    app.get(`/${segment}`, (req, res) => {
      const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
      res.redirect(301, `${withAppBase(basePath, `/${segment}`)}${query}`);
    });
  }
}
