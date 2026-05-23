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

export async function setupAuth(app: Express) {
  if (getAuthProvider() === "clerk") {
    await setupClerkAuth(app);
  } else {
    await setupReplitAuth(app);
  }
}

const providerIsAuthenticated: RequestHandler =
  getAuthProvider() === "clerk" ? clerkIsAuthenticated : replitIsAuthenticated;

export const isAuthenticated = providerIsAuthenticated;
export const requireAuth = isAuthenticated;

export { isOwner, requireRole, requireOrgContext, requireOrgScope };
