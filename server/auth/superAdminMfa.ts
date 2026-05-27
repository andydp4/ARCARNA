import type { RequestHandler } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { storage } from "../storage";
import { getAuthProvider, isDevAuthBypassEnabled } from "../authRuntime";

/**
 * When the signed-in user is SUPER_ADMIN with Clerk, require Clerk MFA (TOTP or equivalent).
 * Non–super-admins pass through. Replit / non-Clerk providers skip this check (document in SECURITY_REVIEW.md).
 */
export const requireSuperAdminMfa: RequestHandler = async (req, res, next) => {
  if (isDevAuthBypassEnabled()) {
    return next();
  }

  const sessionUser = req.user as {
    id?: string;
    claims?: { sub?: string };
    role?: string;
    isOwner?: boolean;
  };
  const sub = sessionUser?.claims?.sub ?? sessionUser?.id;
  if (!sub) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const roleAndOrg = await storage.getUserRoleAndOrg(sub);
  const role =
    sessionUser.role ??
    roleAndOrg?.role ??
    (sessionUser.isOwner ? "SUPER_ADMIN" : "CASHIER");
  if (role !== "SUPER_ADMIN") {
    return next();
  }

  if (getAuthProvider() !== "clerk") {
    return next();
  }

  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const clerkUser = await clerkClient.users.getUser(userId);
    if (!clerkUser.twoFactorEnabled) {
      return res.status(403).json({
        code: "MFA_REQUIRED",
        message:
          "Enable two-factor authentication on your Clerk account before using super-admin tools.",
      });
    }
  } catch (err) {
    console.error("[Auth] Clerk MFA check failed:", err);
    return res.status(503).json({ message: "Unable to verify MFA status" });
  }

  return next();
};
