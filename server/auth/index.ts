import type { Express, RequestHandler } from "express";
import { getAuthProvider } from "../authRuntime";
import { setupClerkAuth, clerkIsAuthenticated } from "./clerkAuth";
import { setupReplitAuth, replitIsAuthenticated } from "../replitAuth";
import { applyPreviewRole } from "./previewRole";
import {
  isOwner,
  requireOrgContext,
  requireOrgScope,
  requireRole,
} from "./commonAuth";

/** Picked once at process start from AUTH_PROVIDER (clerk default). */
function selectIsAuthenticated(): RequestHandler {
  return getAuthProvider() === "clerk" ? clerkIsAuthenticated : replitIsAuthenticated;
}

export async function setupAuth(app: Express) {
  if (getAuthProvider() === "clerk") {
    await setupClerkAuth(app);
  } else {
    await setupReplitAuth(app);
  }
}

const baseIsAuthenticated = selectIsAuthenticated();

/**
 * Sign-in, then "Preview as role" (previewRole.ts) — every route behind
 * isAuthenticated sees the previewed role, so the server enforces the preview
 * exactly as it would for a real manager or cashier.
 */
export const isAuthenticated: RequestHandler = (req, res, next) =>
  baseIsAuthenticated(req, res, (err?: unknown) => {
    if (err) return next(err);
    void applyPreviewRole(req, res, next);
  });

export { isOwner, requireRole, requireOrgContext, requireOrgScope, requireCustomerOrgScope } from "./commonAuth";
export { requireSuperAdminMfa } from "./superAdminMfa";
