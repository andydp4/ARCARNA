import type { Express, RequestHandler } from "express";
import { getAuthProvider } from "../authRuntime";
import { setupClerkAuth, clerkIsAuthenticated } from "./clerkAuth";
import { setupReplitAuth, replitIsAuthenticated } from "../replitAuth";
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

export const isAuthenticated = selectIsAuthenticated();

export { isOwner, requireRole, requireOrgContext, requireOrgScope } from "./commonAuth";
export { requireSuperAdminMfa } from "./superAdminMfa";
